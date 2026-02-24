"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _lodash = _interopRequireDefault(require("lodash"));
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _definitions = require("../definitions");
var _dates = _interopRequireDefault(require("../helpers/dates"));
var _debug = require("../helpers/debug");
var _fetch = require("../helpers/fetch");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
var _errors = require("./errors");
var _browser = require("../helpers/browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const RATE_LIMIT = {
  SLEEP_BETWEEN: 1000,
  TRANSACTIONS_BATCH_SIZE: 10
};
const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD/MM/YYYY';
const debug = (0, _debug.getDebug)('base-isracard-amex');
function getAccountsUrl(servicesUrl, monthMoment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}
async function fetchAccounts(page, servicesUrl, monthMoment) {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  debug(`fetching accounts from ${dataUrl}`);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);
  if (dataResult && _lodash.default.get(dataResult, 'Header.Status') === '1' && dataResult.DashboardMonthBean) {
    const {
      cardsCharges
    } = dataResult.DashboardMonthBean;
    if (cardsCharges) {
      return cardsCharges.map(cardCharge => {
        return {
          index: parseInt(cardCharge.cardIndex, 10),
          accountNumber: cardCharge.cardNumber,
          processedDate: (0, _moment.default)(cardCharge.billingDate, DATE_FORMAT).toISOString()
        };
      });
    }
  }
  return [];
}
function getTransactionsUrl(servicesUrl, monthMoment) {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${month}` : month.toString();
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'CardsTransactionsList');
  url.searchParams.set('month', monthStr);
  url.searchParams.set('year', `${year}`);
  url.searchParams.set('requiredDate', 'N');
  return url.toString();
}
function convertCurrency(currencyStr) {
  if (currencyStr === _constants.SHEKEL_CURRENCY_KEYWORD || currencyStr === _constants.ALT_SHEKEL_CURRENCY) {
    return _constants.SHEKEL_CURRENCY;
  }
  return currencyStr;
}
function getInstallmentsInfo(txn) {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) {
    return undefined;
  }
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return undefined;
  }
  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10)
  };
}
function getTransactionType(txn) {
  return getInstallmentsInfo(txn) ? _transactions2.TransactionTypes.Installments : _transactions2.TransactionTypes.Normal;
}
function convertTransactions(txns, processedDate, options) {
  const filteredTxns = txns.filter(txn => txn.dealSumType !== '1' && txn.voucherNumberRatz !== '000000000' && txn.voucherNumberRatzOutbound !== '000000000');
  return filteredTxns.map(txn => {
    const isOutbound = txn.dealSumOutbound;
    const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
    const txnMoment = (0, _moment.default)(txnDateStr, DATE_FORMAT);
    const currentProcessedDate = txn.fullPaymentDate ? (0, _moment.default)(txn.fullPaymentDate, DATE_FORMAT).toISOString() : processedDate;
    const result = {
      type: getTransactionType(txn),
      identifier: parseInt(isOutbound ? txn.voucherNumberRatzOutbound : txn.voucherNumberRatz, 10),
      date: txnMoment.toISOString(),
      processedDate: currentProcessedDate,
      originalAmount: isOutbound ? -txn.dealSumOutbound : -txn.dealSum,
      originalCurrency: convertCurrency(txn.currentPaymentCurrency ?? txn.currencyId),
      chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
      chargedCurrency: convertCurrency(txn.currencyId),
      description: isOutbound ? txn.fullSupplierNameOutbound : txn.fullSupplierNameHeb,
      memo: txn.moreInfo || '',
      installments: getInstallmentsInfo(txn) || undefined,
      status: _transactions2.TransactionStatuses.Completed
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
async function fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment) {
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataUrl = getTransactionsUrl(companyServiceOptions.servicesUrl, monthMoment);
  await (0, _waiting.sleep)(RATE_LIMIT.SLEEP_BETWEEN);
  debug(`fetching transactions from ${dataUrl} for month ${monthMoment.format('YYYY-MM')}`);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);
  if (dataResult && _lodash.default.get(dataResult, 'Header.Status') === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns = {};
    accounts.forEach(account => {
      const txnGroups = _lodash.default.get(dataResult, `CardsTransactionsListBean.Index${account.index}.CurrentCardTransactions`);
      if (txnGroups) {
        let allTxns = [];
        txnGroups.forEach(txnGroup => {
          if (txnGroup.txnIsrael) {
            const txns = convertTransactions(txnGroup.txnIsrael, account.processedDate, options);
            allTxns.push(...txns);
          }
          if (txnGroup.txnAbroad) {
            const txns = convertTransactions(txnGroup.txnAbroad, account.processedDate, options);
            allTxns.push(...txns);
          }
        });
        if (!options.combineInstallments) {
          allTxns = (0, _transactions.fixInstallments)(allTxns);
        }
        if (options.outputData?.enableTransactionsFilterByDate ?? true) {
          allTxns = (0, _transactions.filterOldTransactions)(allTxns, startMoment, options.combineInstallments || false);
        }
        accountTxns[account.accountNumber] = {
          accountNumber: account.accountNumber,
          index: account.index,
          txns: allTxns
        };
      }
    });
    return accountTxns;
  }
  return {};
}
async function getExtraScrapTransaction(page, options, month, accountIndex, transaction) {
  const url = new URL(options.servicesUrl);
  url.searchParams.set('reqName', 'PirteyIska_204');
  url.searchParams.set('CardIndex', accountIndex.toString());
  url.searchParams.set('shovarRatz', transaction.identifier.toString());
  url.searchParams.set('moedChiuv', month.format('MMYYYY'));
  debug(`fetching extra scrap for transaction ${transaction.identifier} for month ${month.format('YYYY-MM')}`);
  const data = await (0, _fetch.fetchGetWithinPage)(page, url.toString());
  if (!data) {
    return transaction;
  }
  const rawCategory = _lodash.default.get(data, 'PirteyIska_204Bean.sector') ?? '';
  return {
    ...transaction,
    category: rawCategory.trim(),
    rawTransaction: (0, _transactions.getRawTransaction)(data, transaction)
  };
}
async function getExtraScrapAccount(page, options, accountMap, month) {
  const accounts = [];
  for (const account of Object.values(accountMap)) {
    debug(`get extra scrap for ${account.accountNumber} with ${account.txns.length} transactions`, month.format('YYYY-MM'));
    const txns = [];
    for (const txnsChunk of _lodash.default.chunk(account.txns, RATE_LIMIT.TRANSACTIONS_BATCH_SIZE)) {
      debug(`processing chunk of ${txnsChunk.length} transactions for account ${account.accountNumber}`);
      const updatedTxns = await Promise.all(txnsChunk.map(t => getExtraScrapTransaction(page, options, month, account.index, t)));
      await (0, _waiting.sleep)(RATE_LIMIT.SLEEP_BETWEEN);
      txns.push(...updatedTxns);
    }
    accounts.push({
      ...account,
      txns
    });
  }
  return accounts.reduce((m, x) => ({
    ...m,
    [x.accountNumber]: x
  }), {});
}
async function getAdditionalTransactionInformation(scraperOptions, accountsWithIndex, page, options, allMonths) {
  if (!scraperOptions.additionalTransactionInformation || scraperOptions.optInFeatures?.includes('isracard-amex:skipAdditionalTransactionInformation')) {
    return accountsWithIndex;
  }
  return (0, _waiting.runSerial)(accountsWithIndex.map((a, i) => () => getExtraScrapAccount(page, options, a, allMonths[i])));
}
async function fetchAllTransactions(page, options, companyServiceOptions, startMoment) {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const allMonths = (0, _dates.default)(startMoment, futureMonthsToScrape);
  const results = await (0, _waiting.runSerial)(allMonths.map(monthMoment => () => {
    return fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment);
  }));
  const finalResult = await getAdditionalTransactionInformation(options, results, page, companyServiceOptions, allMonths);
  const combinedTxns = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      let txnsForAccount = combinedTxns[accountNumber];
      if (!txnsForAccount) {
        txnsForAccount = [];
        combinedTxns[accountNumber] = txnsForAccount;
      }
      const toBeAddedTxns = result[accountNumber].txns;
      combinedTxns[accountNumber].push(...toBeAddedTxns);
    });
  });
  const accounts = Object.keys(combinedTxns).map(accountNumber => {
    return {
      accountNumber,
      txns: combinedTxns[accountNumber]
    };
  });
  return {
    success: true,
    accounts
  };
}
class IsracardAmexBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  constructor(options, baseUrl, companyCode) {
    super(options);
    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }
  async login(credentials) {
    // Anti-detection: realistic UA, client hints, stealth JS — must run BEFORE navigation
    await (0, _browser.applyAntiDetection)(this.page);
    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      if ((0, _browser.isBotDetectionScript)(request.url())) {
        debug(`blocking bot detection script: ${request.url()}`);
        void request.abort(undefined, _browser.interceptionPriorities.abort);
      } else {
        void request.continue(undefined, _browser.interceptionPriorities.continue);
      }
    });
    debug(`navigating to ${this.baseUrl}/personalarea/Login`);
    await this.navigateTo(`${this.baseUrl}/personalarea/Login`);
    this.emitProgress(_definitions.ScraperProgressTypes.LoggingIn);
    const validatedData = await this.validateCredentials(credentials);
    if (!validatedData) {
      const pageUrl = this.page.url();
      throw new Error(`login validation failed (pageUrl=${pageUrl}). Possible WAF block.`);
    }
    const validateReturnCode = validatedData.returnCode;
    debug(`user validate with return code '${validateReturnCode}'`);
    if (validateReturnCode === '1') {
      const {
        userName
      } = validatedData;
      const loginUrl = `${this.servicesUrl}?reqName=performLogonI`;
      const request = {
        KodMishtamesh: userName,
        MisparZihuy: credentials.id,
        Sisma: credentials.password,
        cardSuffix: credentials.card6Digits,
        countryCode: COUNTRY_CODE,
        idType: ID_TYPE
      };
      debug('user login started');
      const loginResult = await (0, _fetch.fetchPostWithinPage)(this.page, loginUrl, request);
      debug(`user login with status '${loginResult?.status}'`, loginResult);
      if (loginResult && loginResult.status === '1') {
        this.emitProgress(_definitions.ScraperProgressTypes.LoginSuccess);
        return {
          success: true
        };
      }
      if (loginResult && loginResult.status === '3') {
        this.emitProgress(_definitions.ScraperProgressTypes.ChangePassword);
        return {
          success: false,
          errorType: _errors.ScraperErrorTypes.ChangePassword
        };
      }
      this.emitProgress(_definitions.ScraperProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: _errors.ScraperErrorTypes.InvalidPassword
      };
    }
    if (validateReturnCode === '4') {
      this.emitProgress(_definitions.ScraperProgressTypes.ChangePassword);
      return {
        success: false,
        errorType: _errors.ScraperErrorTypes.ChangePassword
      };
    }
    this.emitProgress(_definitions.ScraperProgressTypes.LoginFailed);
    return {
      success: false,
      errorType: _errors.ScraperErrorTypes.InvalidPassword
    };
  }
  async validateCredentials(credentials) {
    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.companyCode
    };
    debug('validating credentials');
    const result = await (0, _fetch.fetchPostWithinPage)(this.page, validateUrl, validateRequest);
    if (!result?.Header || result.Header.Status !== '1' || !result.ValidateIdDataBean) return null;
    return result.ValidateIdDataBean;
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    return fetchAllTransactions(this.page, this.options, {
      servicesUrl: this.servicesUrl,
      companyCode: this.companyCode
    }, startMoment);
  }
}
var _default = exports.default = IsracardAmexBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbG9kYXNoIiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfbW9tZW50IiwiX2NvbnN0YW50cyIsIl9kZWZpbml0aW9ucyIsIl9kYXRlcyIsIl9kZWJ1ZyIsIl9mZXRjaCIsIl90cmFuc2FjdGlvbnMiLCJfd2FpdGluZyIsIl90cmFuc2FjdGlvbnMyIiwiX2Jhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJfZXJyb3JzIiwiX2Jyb3dzZXIiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJSQVRFX0xJTUlUIiwiU0xFRVBfQkVUV0VFTiIsIlRSQU5TQUNUSU9OU19CQVRDSF9TSVpFIiwiQ09VTlRSWV9DT0RFIiwiSURfVFlQRSIsIklOU1RBTExNRU5UU19LRVlXT1JEIiwiREFURV9GT1JNQVQiLCJkZWJ1ZyIsImdldERlYnVnIiwiZ2V0QWNjb3VudHNVcmwiLCJzZXJ2aWNlc1VybCIsIm1vbnRoTW9tZW50IiwiYmlsbGluZ0RhdGUiLCJmb3JtYXQiLCJ1cmwiLCJVUkwiLCJzZWFyY2hQYXJhbXMiLCJzZXQiLCJ0b1N0cmluZyIsImZldGNoQWNjb3VudHMiLCJwYWdlIiwiZGF0YVVybCIsImRhdGFSZXN1bHQiLCJmZXRjaEdldFdpdGhpblBhZ2UiLCJfIiwiZ2V0IiwiRGFzaGJvYXJkTW9udGhCZWFuIiwiY2FyZHNDaGFyZ2VzIiwibWFwIiwiY2FyZENoYXJnZSIsImluZGV4IiwicGFyc2VJbnQiLCJjYXJkSW5kZXgiLCJhY2NvdW50TnVtYmVyIiwiY2FyZE51bWJlciIsInByb2Nlc3NlZERhdGUiLCJtb21lbnQiLCJ0b0lTT1N0cmluZyIsImdldFRyYW5zYWN0aW9uc1VybCIsIm1vbnRoIiwieWVhciIsIm1vbnRoU3RyIiwiY29udmVydEN1cnJlbmN5IiwiY3VycmVuY3lTdHIiLCJTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCIsIkFMVF9TSEVLRUxfQ1VSUkVOQ1kiLCJTSEVLRUxfQ1VSUkVOQ1kiLCJnZXRJbnN0YWxsbWVudHNJbmZvIiwidHhuIiwibW9yZUluZm8iLCJpbmNsdWRlcyIsInVuZGVmaW5lZCIsIm1hdGNoZXMiLCJtYXRjaCIsImxlbmd0aCIsIm51bWJlciIsInRvdGFsIiwiZ2V0VHJhbnNhY3Rpb25UeXBlIiwiVHJhbnNhY3Rpb25UeXBlcyIsIkluc3RhbGxtZW50cyIsIk5vcm1hbCIsImNvbnZlcnRUcmFuc2FjdGlvbnMiLCJ0eG5zIiwib3B0aW9ucyIsImZpbHRlcmVkVHhucyIsImZpbHRlciIsImRlYWxTdW1UeXBlIiwidm91Y2hlck51bWJlclJhdHoiLCJ2b3VjaGVyTnVtYmVyUmF0ek91dGJvdW5kIiwiaXNPdXRib3VuZCIsImRlYWxTdW1PdXRib3VuZCIsInR4bkRhdGVTdHIiLCJmdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQiLCJmdWxsUHVyY2hhc2VEYXRlIiwidHhuTW9tZW50IiwiY3VycmVudFByb2Nlc3NlZERhdGUiLCJmdWxsUGF5bWVudERhdGUiLCJyZXN1bHQiLCJ0eXBlIiwiaWRlbnRpZmllciIsImRhdGUiLCJvcmlnaW5hbEFtb3VudCIsImRlYWxTdW0iLCJvcmlnaW5hbEN1cnJlbmN5IiwiY3VycmVudFBheW1lbnRDdXJyZW5jeSIsImN1cnJlbmN5SWQiLCJjaGFyZ2VkQW1vdW50IiwicGF5bWVudFN1bU91dGJvdW5kIiwicGF5bWVudFN1bSIsImNoYXJnZWRDdXJyZW5jeSIsImRlc2NyaXB0aW9uIiwiZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kIiwiZnVsbFN1cHBsaWVyTmFtZUhlYiIsIm1lbW8iLCJpbnN0YWxsbWVudHMiLCJzdGF0dXMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiQ29tcGxldGVkIiwiaW5jbHVkZVJhd1RyYW5zYWN0aW9uIiwicmF3VHJhbnNhY3Rpb24iLCJnZXRSYXdUcmFuc2FjdGlvbiIsImZldGNoVHJhbnNhY3Rpb25zIiwiY29tcGFueVNlcnZpY2VPcHRpb25zIiwic3RhcnRNb21lbnQiLCJhY2NvdW50cyIsInNsZWVwIiwiQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbiIsImFjY291bnRUeG5zIiwiZm9yRWFjaCIsImFjY291bnQiLCJ0eG5Hcm91cHMiLCJhbGxUeG5zIiwidHhuR3JvdXAiLCJ0eG5Jc3JhZWwiLCJwdXNoIiwidHhuQWJyb2FkIiwiY29tYmluZUluc3RhbGxtZW50cyIsImZpeEluc3RhbGxtZW50cyIsIm91dHB1dERhdGEiLCJlbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUiLCJmaWx0ZXJPbGRUcmFuc2FjdGlvbnMiLCJnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24iLCJhY2NvdW50SW5kZXgiLCJ0cmFuc2FjdGlvbiIsImRhdGEiLCJyYXdDYXRlZ29yeSIsImNhdGVnb3J5IiwidHJpbSIsImdldEV4dHJhU2NyYXBBY2NvdW50IiwiYWNjb3VudE1hcCIsIk9iamVjdCIsInZhbHVlcyIsInR4bnNDaHVuayIsImNodW5rIiwidXBkYXRlZFR4bnMiLCJQcm9taXNlIiwiYWxsIiwidCIsInJlZHVjZSIsIm0iLCJ4IiwiZ2V0QWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24iLCJzY3JhcGVyT3B0aW9ucyIsImFjY291bnRzV2l0aEluZGV4IiwiYWxsTW9udGhzIiwiYWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24iLCJvcHRJbkZlYXR1cmVzIiwicnVuU2VyaWFsIiwiYSIsImkiLCJmZXRjaEFsbFRyYW5zYWN0aW9ucyIsImZ1dHVyZU1vbnRoc1RvU2NyYXBlIiwiZ2V0QWxsTW9udGhNb21lbnRzIiwicmVzdWx0cyIsImZpbmFsUmVzdWx0IiwiY29tYmluZWRUeG5zIiwia2V5cyIsInR4bnNGb3JBY2NvdW50IiwidG9CZUFkZGVkVHhucyIsInN1Y2Nlc3MiLCJJc3JhY2FyZEFtZXhCYXNlU2NyYXBlciIsIkJhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJjb25zdHJ1Y3RvciIsImJhc2VVcmwiLCJjb21wYW55Q29kZSIsImxvZ2luIiwiY3JlZGVudGlhbHMiLCJhcHBseUFudGlEZXRlY3Rpb24iLCJzZXRSZXF1ZXN0SW50ZXJjZXB0aW9uIiwib24iLCJyZXF1ZXN0IiwiaXNCb3REZXRlY3Rpb25TY3JpcHQiLCJhYm9ydCIsImludGVyY2VwdGlvblByaW9yaXRpZXMiLCJjb250aW51ZSIsIm5hdmlnYXRlVG8iLCJlbWl0UHJvZ3Jlc3MiLCJTY3JhcGVyUHJvZ3Jlc3NUeXBlcyIsIkxvZ2dpbmdJbiIsInZhbGlkYXRlZERhdGEiLCJ2YWxpZGF0ZUNyZWRlbnRpYWxzIiwicGFnZVVybCIsIkVycm9yIiwidmFsaWRhdGVSZXR1cm5Db2RlIiwicmV0dXJuQ29kZSIsInVzZXJOYW1lIiwibG9naW5VcmwiLCJLb2RNaXNodGFtZXNoIiwiTWlzcGFyWmlodXkiLCJpZCIsIlNpc21hIiwicGFzc3dvcmQiLCJjYXJkU3VmZml4IiwiY2FyZDZEaWdpdHMiLCJjb3VudHJ5Q29kZSIsImlkVHlwZSIsImxvZ2luUmVzdWx0IiwiZmV0Y2hQb3N0V2l0aGluUGFnZSIsIkxvZ2luU3VjY2VzcyIsIkNoYW5nZVBhc3N3b3JkIiwiZXJyb3JUeXBlIiwiU2NyYXBlckVycm9yVHlwZXMiLCJMb2dpbkZhaWxlZCIsIkludmFsaWRQYXNzd29yZCIsInZhbGlkYXRlVXJsIiwidmFsaWRhdGVSZXF1ZXN0IiwiY2hlY2tMZXZlbCIsIkhlYWRlciIsIlN0YXR1cyIsIlZhbGlkYXRlSWREYXRhQmVhbiIsImZldGNoRGF0YSIsImRlZmF1bHRTdGFydE1vbWVudCIsInN1YnRyYWN0Iiwic3RhcnREYXRlIiwidG9EYXRlIiwibWF4IiwiX2RlZmF1bHQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmFwZXJzL2Jhc2UtaXNyYWNhcmQtYW1leC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xyXG5pbXBvcnQgbW9tZW50LCB7IHR5cGUgTW9tZW50IH0gZnJvbSAnbW9tZW50JztcclxuaW1wb3J0IHsgdHlwZSBQYWdlIH0gZnJvbSAncHVwcGV0ZWVyJztcclxuaW1wb3J0IHsgQUxUX1NIRUtFTF9DVVJSRU5DWSwgU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCB9IGZyb20gJy4uL2NvbnN0YW50cyc7XHJcbmltcG9ydCB7IFNjcmFwZXJQcm9ncmVzc1R5cGVzIH0gZnJvbSAnLi4vZGVmaW5pdGlvbnMnO1xyXG5pbXBvcnQgZ2V0QWxsTW9udGhNb21lbnRzIGZyb20gJy4uL2hlbHBlcnMvZGF0ZXMnO1xyXG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xyXG5pbXBvcnQgeyBmZXRjaEdldFdpdGhpblBhZ2UsIGZldGNoUG9zdFdpdGhpblBhZ2UgfSBmcm9tICcuLi9oZWxwZXJzL2ZldGNoJztcclxuaW1wb3J0IHsgZmlsdGVyT2xkVHJhbnNhY3Rpb25zLCBmaXhJbnN0YWxsbWVudHMsIGdldFJhd1RyYW5zYWN0aW9uIH0gZnJvbSAnLi4vaGVscGVycy90cmFuc2FjdGlvbnMnO1xyXG5pbXBvcnQgeyBydW5TZXJpYWwsIHNsZWVwIH0gZnJvbSAnLi4vaGVscGVycy93YWl0aW5nJztcclxuaW1wb3J0IHtcclxuICBUcmFuc2FjdGlvblN0YXR1c2VzLFxyXG4gIFRyYW5zYWN0aW9uVHlwZXMsXHJcbiAgdHlwZSBUcmFuc2FjdGlvbixcclxuICB0eXBlIFRyYW5zYWN0aW9uSW5zdGFsbG1lbnRzLFxyXG4gIHR5cGUgVHJhbnNhY3Rpb25zQWNjb3VudCxcclxufSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xyXG5pbXBvcnQgeyBCYXNlU2NyYXBlcldpdGhCcm93c2VyIH0gZnJvbSAnLi9iYXNlLXNjcmFwZXItd2l0aC1icm93c2VyJztcclxuaW1wb3J0IHsgU2NyYXBlckVycm9yVHlwZXMgfSBmcm9tICcuL2Vycm9ycyc7XHJcbmltcG9ydCB7IHR5cGUgU2NyYXBlck9wdGlvbnMsIHR5cGUgU2NyYXBlclNjcmFwaW5nUmVzdWx0IH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xyXG5pbXBvcnQgeyBhcHBseUFudGlEZXRlY3Rpb24sIGludGVyY2VwdGlvblByaW9yaXRpZXMsIGlzQm90RGV0ZWN0aW9uU2NyaXB0IH0gZnJvbSAnLi4vaGVscGVycy9icm93c2VyJztcclxuXHJcbmNvbnN0IFJBVEVfTElNSVQgPSB7XHJcbiAgU0xFRVBfQkVUV0VFTjogMTAwMCxcclxuICBUUkFOU0FDVElPTlNfQkFUQ0hfU0laRTogMTAsXHJcbn0gYXMgY29uc3Q7XHJcblxyXG5jb25zdCBDT1VOVFJZX0NPREUgPSAnMjEyJztcclxuY29uc3QgSURfVFlQRSA9ICcxJztcclxuY29uc3QgSU5TVEFMTE1FTlRTX0tFWVdPUkQgPSAn16rXqdec15XXnSc7XHJcblxyXG5jb25zdCBEQVRFX0ZPUk1BVCA9ICdERC9NTS9ZWVlZJztcclxuXHJcbmNvbnN0IGRlYnVnID0gZ2V0RGVidWcoJ2Jhc2UtaXNyYWNhcmQtYW1leCcpO1xyXG5cclxudHlwZSBDb21wYW55U2VydmljZU9wdGlvbnMgPSB7XHJcbiAgc2VydmljZXNVcmw6IHN0cmluZztcclxuICBjb21wYW55Q29kZTogc3RyaW5nO1xyXG59O1xyXG5cclxudHlwZSBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXggPSBSZWNvcmQ8c3RyaW5nLCBUcmFuc2FjdGlvbnNBY2NvdW50ICYgeyBpbmRleDogbnVtYmVyIH0+O1xyXG5cclxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbiB7XHJcbiAgZGVhbFN1bVR5cGU6IHN0cmluZztcclxuICB2b3VjaGVyTnVtYmVyUmF0ek91dGJvdW5kOiBzdHJpbmc7XHJcbiAgdm91Y2hlck51bWJlclJhdHo6IHN0cmluZztcclxuICBtb3JlSW5mbz86IHN0cmluZztcclxuICBkZWFsU3VtT3V0Ym91bmQ6IGJvb2xlYW47XHJcbiAgY3VycmVuY3lJZDogc3RyaW5nO1xyXG4gIGN1cnJlbnRQYXltZW50Q3VycmVuY3k6IHN0cmluZztcclxuICBkZWFsU3VtOiBudW1iZXI7XHJcbiAgZnVsbFBheW1lbnREYXRlPzogc3RyaW5nO1xyXG4gIGZ1bGxQdXJjaGFzZURhdGU/OiBzdHJpbmc7XHJcbiAgZnVsbFB1cmNoYXNlRGF0ZU91dGJvdW5kPzogc3RyaW5nO1xyXG4gIGZ1bGxTdXBwbGllck5hbWVIZWI6IHN0cmluZztcclxuICBmdWxsU3VwcGxpZXJOYW1lT3V0Ym91bmQ6IHN0cmluZztcclxuICBwYXltZW50U3VtOiBudW1iZXI7XHJcbiAgcGF5bWVudFN1bU91dGJvdW5kOiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBTY3JhcGVkQWNjb3VudCB7XHJcbiAgaW5kZXg6IG51bWJlcjtcclxuICBhY2NvdW50TnVtYmVyOiBzdHJpbmc7XHJcbiAgcHJvY2Vzc2VkRGF0ZTogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgU2NyYXBlZExvZ2luVmFsaWRhdGlvbiB7XHJcbiAgSGVhZGVyOiB7XHJcbiAgICBTdGF0dXM6IHN0cmluZztcclxuICB9O1xyXG4gIFZhbGlkYXRlSWREYXRhQmVhbj86IHtcclxuICAgIHVzZXJOYW1lPzogc3RyaW5nO1xyXG4gICAgcmV0dXJuQ29kZTogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBTY3JhcGVkQWNjb3VudHNXaXRoaW5QYWdlUmVzcG9uc2Uge1xyXG4gIEhlYWRlcjoge1xyXG4gICAgU3RhdHVzOiBzdHJpbmc7XHJcbiAgfTtcclxuICBEYXNoYm9hcmRNb250aEJlYW4/OiB7XHJcbiAgICBjYXJkc0NoYXJnZXM6IHtcclxuICAgICAgY2FyZEluZGV4OiBzdHJpbmc7XHJcbiAgICAgIGNhcmROdW1iZXI6IHN0cmluZztcclxuICAgICAgYmlsbGluZ0RhdGU6IHN0cmluZztcclxuICAgIH1bXTtcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgU2NyYXBlZEN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zIHtcclxuICB0eG5Jc3JhZWw/OiBTY3JhcGVkVHJhbnNhY3Rpb25bXTtcclxuICB0eG5BYnJvYWQ/OiBTY3JhcGVkVHJhbnNhY3Rpb25bXTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbkRhdGEge1xyXG4gIEhlYWRlcj86IHtcclxuICAgIFN0YXR1czogc3RyaW5nO1xyXG4gIH07XHJcbiAgUGlydGV5SXNrYV8yMDRCZWFuPzoge1xyXG4gICAgc2VjdG9yOiBzdHJpbmc7XHJcbiAgfTtcclxuXHJcbiAgQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbj86IFJlY29yZDxcclxuICAgIHN0cmluZyxcclxuICAgIHtcclxuICAgICAgQ3VycmVudENhcmRUcmFuc2FjdGlvbnM6IFNjcmFwZWRDdXJyZW50Q2FyZFRyYW5zYWN0aW9uc1tdO1xyXG4gICAgfVxyXG4gID47XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldEFjY291bnRzVXJsKHNlcnZpY2VzVXJsOiBzdHJpbmcsIG1vbnRoTW9tZW50OiBNb21lbnQpIHtcclxuICBjb25zdCBiaWxsaW5nRGF0ZSA9IG1vbnRoTW9tZW50LmZvcm1hdCgnWVlZWS1NTS1ERCcpO1xyXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoc2VydmljZXNVcmwpO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdyZXFOYW1lJywgJ0Rhc2hib2FyZE1vbnRoJyk7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2FjdGlvbkNvZGUnLCAnMCcpO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdiaWxsaW5nRGF0ZScsIGJpbGxpbmdEYXRlKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnZm9ybWF0JywgJ0pzb24nKTtcclxuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudHMocGFnZTogUGFnZSwgc2VydmljZXNVcmw6IHN0cmluZywgbW9udGhNb21lbnQ6IE1vbWVudCk6IFByb21pc2U8U2NyYXBlZEFjY291bnRbXT4ge1xyXG4gIGNvbnN0IGRhdGFVcmwgPSBnZXRBY2NvdW50c1VybChzZXJ2aWNlc1VybCwgbW9udGhNb21lbnQpO1xyXG4gIGRlYnVnKGBmZXRjaGluZyBhY2NvdW50cyBmcm9tICR7ZGF0YVVybH1gKTtcclxuICBjb25zdCBkYXRhUmVzdWx0ID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRBY2NvdW50c1dpdGhpblBhZ2VSZXNwb25zZT4ocGFnZSwgZGF0YVVybCk7XHJcbiAgaWYgKGRhdGFSZXN1bHQgJiYgXy5nZXQoZGF0YVJlc3VsdCwgJ0hlYWRlci5TdGF0dXMnKSA9PT0gJzEnICYmIGRhdGFSZXN1bHQuRGFzaGJvYXJkTW9udGhCZWFuKSB7XHJcbiAgICBjb25zdCB7IGNhcmRzQ2hhcmdlcyB9ID0gZGF0YVJlc3VsdC5EYXNoYm9hcmRNb250aEJlYW47XHJcbiAgICBpZiAoY2FyZHNDaGFyZ2VzKSB7XHJcbiAgICAgIHJldHVybiBjYXJkc0NoYXJnZXMubWFwKGNhcmRDaGFyZ2UgPT4ge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBpbmRleDogcGFyc2VJbnQoY2FyZENoYXJnZS5jYXJkSW5kZXgsIDEwKSxcclxuICAgICAgICAgIGFjY291bnROdW1iZXI6IGNhcmRDaGFyZ2UuY2FyZE51bWJlcixcclxuICAgICAgICAgIHByb2Nlc3NlZERhdGU6IG1vbWVudChjYXJkQ2hhcmdlLmJpbGxpbmdEYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICB9O1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIFtdO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbnNVcmwoc2VydmljZXNVcmw6IHN0cmluZywgbW9udGhNb21lbnQ6IE1vbWVudCkge1xyXG4gIGNvbnN0IG1vbnRoID0gbW9udGhNb21lbnQubW9udGgoKSArIDE7XHJcbiAgY29uc3QgeWVhciA9IG1vbnRoTW9tZW50LnllYXIoKTtcclxuICBjb25zdCBtb250aFN0ciA9IG1vbnRoIDwgMTAgPyBgMCR7bW9udGh9YCA6IG1vbnRoLnRvU3RyaW5nKCk7XHJcbiAgY29uc3QgdXJsID0gbmV3IFVSTChzZXJ2aWNlc1VybCk7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3JlcU5hbWUnLCAnQ2FyZHNUcmFuc2FjdGlvbnNMaXN0Jyk7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ21vbnRoJywgbW9udGhTdHIpO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd5ZWFyJywgYCR7eWVhcn1gKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgncmVxdWlyZWREYXRlJywgJ04nKTtcclxuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbnZlcnRDdXJyZW5jeShjdXJyZW5jeVN0cjogc3RyaW5nKSB7XHJcbiAgaWYgKGN1cnJlbmN5U3RyID09PSBTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCB8fCBjdXJyZW5jeVN0ciA9PT0gQUxUX1NIRUtFTF9DVVJSRU5DWSkge1xyXG4gICAgcmV0dXJuIFNIRUtFTF9DVVJSRU5DWTtcclxuICB9XHJcbiAgcmV0dXJuIGN1cnJlbmN5U3RyO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRJbnN0YWxsbWVudHNJbmZvKHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKTogVHJhbnNhY3Rpb25JbnN0YWxsbWVudHMgfCB1bmRlZmluZWQge1xyXG4gIGlmICghdHhuLm1vcmVJbmZvIHx8ICF0eG4ubW9yZUluZm8uaW5jbHVkZXMoSU5TVEFMTE1FTlRTX0tFWVdPUkQpKSB7XHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gIH1cclxuICBjb25zdCBtYXRjaGVzID0gdHhuLm1vcmVJbmZvLm1hdGNoKC9cXGQrL2cpO1xyXG4gIGlmICghbWF0Y2hlcyB8fCBtYXRjaGVzLmxlbmd0aCA8IDIpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgfVxyXG5cclxuICByZXR1cm4ge1xyXG4gICAgbnVtYmVyOiBwYXJzZUludChtYXRjaGVzWzBdLCAxMCksXHJcbiAgICB0b3RhbDogcGFyc2VJbnQobWF0Y2hlc1sxXSwgMTApLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uVHlwZSh0eG46IFNjcmFwZWRUcmFuc2FjdGlvbikge1xyXG4gIHJldHVybiBnZXRJbnN0YWxsbWVudHNJbmZvKHR4bikgPyBUcmFuc2FjdGlvblR5cGVzLkluc3RhbGxtZW50cyA6IFRyYW5zYWN0aW9uVHlwZXMuTm9ybWFsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb252ZXJ0VHJhbnNhY3Rpb25zKFxyXG4gIHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdLFxyXG4gIHByb2Nlc3NlZERhdGU6IHN0cmluZyxcclxuICBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMsXHJcbik6IFRyYW5zYWN0aW9uW10ge1xyXG4gIGNvbnN0IGZpbHRlcmVkVHhucyA9IHR4bnMuZmlsdGVyKFxyXG4gICAgdHhuID0+XHJcbiAgICAgIHR4bi5kZWFsU3VtVHlwZSAhPT0gJzEnICYmIHR4bi52b3VjaGVyTnVtYmVyUmF0eiAhPT0gJzAwMDAwMDAwMCcgJiYgdHhuLnZvdWNoZXJOdW1iZXJSYXR6T3V0Ym91bmQgIT09ICcwMDAwMDAwMDAnLFxyXG4gICk7XHJcblxyXG4gIHJldHVybiBmaWx0ZXJlZFR4bnMubWFwKHR4biA9PiB7XHJcbiAgICBjb25zdCBpc091dGJvdW5kID0gdHhuLmRlYWxTdW1PdXRib3VuZDtcclxuICAgIGNvbnN0IHR4bkRhdGVTdHIgPSBpc091dGJvdW5kID8gdHhuLmZ1bGxQdXJjaGFzZURhdGVPdXRib3VuZCA6IHR4bi5mdWxsUHVyY2hhc2VEYXRlO1xyXG4gICAgY29uc3QgdHhuTW9tZW50ID0gbW9tZW50KHR4bkRhdGVTdHIsIERBVEVfRk9STUFUKTtcclxuXHJcbiAgICBjb25zdCBjdXJyZW50UHJvY2Vzc2VkRGF0ZSA9IHR4bi5mdWxsUGF5bWVudERhdGVcclxuICAgICAgPyBtb21lbnQodHhuLmZ1bGxQYXltZW50RGF0ZSwgREFURV9GT1JNQVQpLnRvSVNPU3RyaW5nKClcclxuICAgICAgOiBwcm9jZXNzZWREYXRlO1xyXG4gICAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbiA9IHtcclxuICAgICAgdHlwZTogZ2V0VHJhbnNhY3Rpb25UeXBlKHR4biksXHJcbiAgICAgIGlkZW50aWZpZXI6IHBhcnNlSW50KGlzT3V0Ym91bmQgPyB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCA6IHR4bi52b3VjaGVyTnVtYmVyUmF0eiwgMTApLFxyXG4gICAgICBkYXRlOiB0eG5Nb21lbnQudG9JU09TdHJpbmcoKSxcclxuICAgICAgcHJvY2Vzc2VkRGF0ZTogY3VycmVudFByb2Nlc3NlZERhdGUsXHJcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBpc091dGJvdW5kID8gLXR4bi5kZWFsU3VtT3V0Ym91bmQgOiAtdHhuLmRlYWxTdW0sXHJcbiAgICAgIG9yaWdpbmFsQ3VycmVuY3k6IGNvbnZlcnRDdXJyZW5jeSh0eG4uY3VycmVudFBheW1lbnRDdXJyZW5jeSA/PyB0eG4uY3VycmVuY3lJZCksXHJcbiAgICAgIGNoYXJnZWRBbW91bnQ6IGlzT3V0Ym91bmQgPyAtdHhuLnBheW1lbnRTdW1PdXRib3VuZCA6IC10eG4ucGF5bWVudFN1bSxcclxuICAgICAgY2hhcmdlZEN1cnJlbmN5OiBjb252ZXJ0Q3VycmVuY3kodHhuLmN1cnJlbmN5SWQpLFxyXG4gICAgICBkZXNjcmlwdGlvbjogaXNPdXRib3VuZCA/IHR4bi5mdWxsU3VwcGxpZXJOYW1lT3V0Ym91bmQgOiB0eG4uZnVsbFN1cHBsaWVyTmFtZUhlYixcclxuICAgICAgbWVtbzogdHhuLm1vcmVJbmZvIHx8ICcnLFxyXG4gICAgICBpbnN0YWxsbWVudHM6IGdldEluc3RhbGxtZW50c0luZm8odHhuKSB8fCB1bmRlZmluZWQsXHJcbiAgICAgIHN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcy5Db21wbGV0ZWQsXHJcbiAgICB9O1xyXG5cclxuICAgIGlmIChvcHRpb25zPy5pbmNsdWRlUmF3VHJhbnNhY3Rpb24pIHtcclxuICAgICAgcmVzdWx0LnJhd1RyYW5zYWN0aW9uID0gZ2V0UmF3VHJhbnNhY3Rpb24odHhuKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH0pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmZXRjaFRyYW5zYWN0aW9ucyhcclxuICBwYWdlOiBQYWdlLFxyXG4gIG9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLFxyXG4gIGNvbXBhbnlTZXJ2aWNlT3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxyXG4gIHN0YXJ0TW9tZW50OiBNb21lbnQsXHJcbiAgbW9udGhNb21lbnQ6IE1vbWVudCxcclxuKTogUHJvbWlzZTxTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXg+IHtcclxuICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IGZldGNoQWNjb3VudHMocGFnZSwgY29tcGFueVNlcnZpY2VPcHRpb25zLnNlcnZpY2VzVXJsLCBtb250aE1vbWVudCk7XHJcbiAgY29uc3QgZGF0YVVybCA9IGdldFRyYW5zYWN0aW9uc1VybChjb21wYW55U2VydmljZU9wdGlvbnMuc2VydmljZXNVcmwsIG1vbnRoTW9tZW50KTtcclxuICBhd2FpdCBzbGVlcChSQVRFX0xJTUlULlNMRUVQX0JFVFdFRU4pO1xyXG4gIGRlYnVnKGBmZXRjaGluZyB0cmFuc2FjdGlvbnMgZnJvbSAke2RhdGFVcmx9IGZvciBtb250aCAke21vbnRoTW9tZW50LmZvcm1hdCgnWVlZWS1NTScpfWApO1xyXG4gIGNvbnN0IGRhdGFSZXN1bHQgPSBhd2FpdCBmZXRjaEdldFdpdGhpblBhZ2U8U2NyYXBlZFRyYW5zYWN0aW9uRGF0YT4ocGFnZSwgZGF0YVVybCk7XHJcbiAgaWYgKGRhdGFSZXN1bHQgJiYgXy5nZXQoZGF0YVJlc3VsdCwgJ0hlYWRlci5TdGF0dXMnKSA9PT0gJzEnICYmIGRhdGFSZXN1bHQuQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbikge1xyXG4gICAgY29uc3QgYWNjb3VudFR4bnM6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleCA9IHt9O1xyXG4gICAgYWNjb3VudHMuZm9yRWFjaChhY2NvdW50ID0+IHtcclxuICAgICAgY29uc3QgdHhuR3JvdXBzOiBTY3JhcGVkQ3VycmVudENhcmRUcmFuc2FjdGlvbnNbXSB8IHVuZGVmaW5lZCA9IF8uZ2V0KFxyXG4gICAgICAgIGRhdGFSZXN1bHQsXHJcbiAgICAgICAgYENhcmRzVHJhbnNhY3Rpb25zTGlzdEJlYW4uSW5kZXgke2FjY291bnQuaW5kZXh9LkN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zYCxcclxuICAgICAgKTtcclxuICAgICAgaWYgKHR4bkdyb3Vwcykge1xyXG4gICAgICAgIGxldCBhbGxUeG5zOiBUcmFuc2FjdGlvbltdID0gW107XHJcbiAgICAgICAgdHhuR3JvdXBzLmZvckVhY2godHhuR3JvdXAgPT4ge1xyXG4gICAgICAgICAgaWYgKHR4bkdyb3VwLnR4bklzcmFlbCkge1xyXG4gICAgICAgICAgICBjb25zdCB0eG5zID0gY29udmVydFRyYW5zYWN0aW9ucyh0eG5Hcm91cC50eG5Jc3JhZWwsIGFjY291bnQucHJvY2Vzc2VkRGF0ZSwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIGFsbFR4bnMucHVzaCguLi50eG5zKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGlmICh0eG5Hcm91cC50eG5BYnJvYWQpIHtcclxuICAgICAgICAgICAgY29uc3QgdHhucyA9IGNvbnZlcnRUcmFuc2FjdGlvbnModHhuR3JvdXAudHhuQWJyb2FkLCBhY2NvdW50LnByb2Nlc3NlZERhdGUsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBhbGxUeG5zLnB1c2goLi4udHhucyk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGlmICghb3B0aW9ucy5jb21iaW5lSW5zdGFsbG1lbnRzKSB7XHJcbiAgICAgICAgICBhbGxUeG5zID0gZml4SW5zdGFsbG1lbnRzKGFsbFR4bnMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAob3B0aW9ucy5vdXRwdXREYXRhPy5lbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUgPz8gdHJ1ZSkge1xyXG4gICAgICAgICAgYWxsVHhucyA9IGZpbHRlck9sZFRyYW5zYWN0aW9ucyhhbGxUeG5zLCBzdGFydE1vbWVudCwgb3B0aW9ucy5jb21iaW5lSW5zdGFsbG1lbnRzIHx8IGZhbHNlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgYWNjb3VudFR4bnNbYWNjb3VudC5hY2NvdW50TnVtYmVyXSA9IHtcclxuICAgICAgICAgIGFjY291bnROdW1iZXI6IGFjY291bnQuYWNjb3VudE51bWJlcixcclxuICAgICAgICAgIGluZGV4OiBhY2NvdW50LmluZGV4LFxyXG4gICAgICAgICAgdHhuczogYWxsVHhucyxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBhY2NvdW50VHhucztcclxuICB9XHJcblxyXG4gIHJldHVybiB7fTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0RXh0cmFTY3JhcFRyYW5zYWN0aW9uKFxyXG4gIHBhZ2U6IFBhZ2UsXHJcbiAgb3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxyXG4gIG1vbnRoOiBNb21lbnQsXHJcbiAgYWNjb3VudEluZGV4OiBudW1iZXIsXHJcbiAgdHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uLFxyXG4pOiBQcm9taXNlPFRyYW5zYWN0aW9uPiB7XHJcbiAgY29uc3QgdXJsID0gbmV3IFVSTChvcHRpb25zLnNlcnZpY2VzVXJsKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgncmVxTmFtZScsICdQaXJ0ZXlJc2thXzIwNCcpO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdDYXJkSW5kZXgnLCBhY2NvdW50SW5kZXgudG9TdHJpbmcoKSk7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3Nob3ZhclJhdHonLCB0cmFuc2FjdGlvbi5pZGVudGlmaWVyIS50b1N0cmluZygpKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnbW9lZENoaXV2JywgbW9udGguZm9ybWF0KCdNTVlZWVknKSk7XHJcblxyXG4gIGRlYnVnKGBmZXRjaGluZyBleHRyYSBzY3JhcCBmb3IgdHJhbnNhY3Rpb24gJHt0cmFuc2FjdGlvbi5pZGVudGlmaWVyfSBmb3IgbW9udGggJHttb250aC5mb3JtYXQoJ1lZWVktTU0nKX1gKTtcclxuICBjb25zdCBkYXRhID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRUcmFuc2FjdGlvbkRhdGE+KHBhZ2UsIHVybC50b1N0cmluZygpKTtcclxuICBpZiAoIWRhdGEpIHtcclxuICAgIHJldHVybiB0cmFuc2FjdGlvbjtcclxuICB9XHJcblxyXG4gIGNvbnN0IHJhd0NhdGVnb3J5ID0gXy5nZXQoZGF0YSwgJ1BpcnRleUlza2FfMjA0QmVhbi5zZWN0b3InKSA/PyAnJztcclxuICByZXR1cm4ge1xyXG4gICAgLi4udHJhbnNhY3Rpb24sXHJcbiAgICBjYXRlZ29yeTogcmF3Q2F0ZWdvcnkudHJpbSgpLFxyXG4gICAgcmF3VHJhbnNhY3Rpb246IGdldFJhd1RyYW5zYWN0aW9uKGRhdGEsIHRyYW5zYWN0aW9uKSxcclxuICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRFeHRyYVNjcmFwQWNjb3VudChcclxuICBwYWdlOiBQYWdlLFxyXG4gIG9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcclxuICBhY2NvdW50TWFwOiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXgsXHJcbiAgbW9udGg6IG1vbWVudC5Nb21lbnQsXHJcbik6IFByb21pc2U8U2NyYXBlZEFjY291bnRzV2l0aEluZGV4PiB7XHJcbiAgY29uc3QgYWNjb3VudHM6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtzdHJpbmddW10gPSBbXTtcclxuICBmb3IgKGNvbnN0IGFjY291bnQgb2YgT2JqZWN0LnZhbHVlcyhhY2NvdW50TWFwKSkge1xyXG4gICAgZGVidWcoXHJcbiAgICAgIGBnZXQgZXh0cmEgc2NyYXAgZm9yICR7YWNjb3VudC5hY2NvdW50TnVtYmVyfSB3aXRoICR7YWNjb3VudC50eG5zLmxlbmd0aH0gdHJhbnNhY3Rpb25zYCxcclxuICAgICAgbW9udGguZm9ybWF0KCdZWVlZLU1NJyksXHJcbiAgICApO1xyXG4gICAgY29uc3QgdHhuczogVHJhbnNhY3Rpb25bXSA9IFtdO1xyXG4gICAgZm9yIChjb25zdCB0eG5zQ2h1bmsgb2YgXy5jaHVuayhhY2NvdW50LnR4bnMsIFJBVEVfTElNSVQuVFJBTlNBQ1RJT05TX0JBVENIX1NJWkUpKSB7XHJcbiAgICAgIGRlYnVnKGBwcm9jZXNzaW5nIGNodW5rIG9mICR7dHhuc0NodW5rLmxlbmd0aH0gdHJhbnNhY3Rpb25zIGZvciBhY2NvdW50ICR7YWNjb3VudC5hY2NvdW50TnVtYmVyfWApO1xyXG4gICAgICBjb25zdCB1cGRhdGVkVHhucyA9IGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgICAgIHR4bnNDaHVuay5tYXAodCA9PiBnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24ocGFnZSwgb3B0aW9ucywgbW9udGgsIGFjY291bnQuaW5kZXgsIHQpKSxcclxuICAgICAgKTtcclxuICAgICAgYXdhaXQgc2xlZXAoUkFURV9MSU1JVC5TTEVFUF9CRVRXRUVOKTtcclxuICAgICAgdHhucy5wdXNoKC4uLnVwZGF0ZWRUeG5zKTtcclxuICAgIH1cclxuICAgIGFjY291bnRzLnB1c2goeyAuLi5hY2NvdW50LCB0eG5zIH0pO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGFjY291bnRzLnJlZHVjZSgobSwgeCkgPT4gKHsgLi4ubSwgW3guYWNjb3VudE51bWJlcl06IHggfSksIHt9KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0QWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24oXHJcbiAgc2NyYXBlck9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLFxyXG4gIGFjY291bnRzV2l0aEluZGV4OiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXhbXSxcclxuICBwYWdlOiBQYWdlLFxyXG4gIG9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcclxuICBhbGxNb250aHM6IG1vbWVudC5Nb21lbnRbXSxcclxuKTogUHJvbWlzZTxTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXhbXT4ge1xyXG4gIGlmIChcclxuICAgICFzY3JhcGVyT3B0aW9ucy5hZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbiB8fFxyXG4gICAgc2NyYXBlck9wdGlvbnMub3B0SW5GZWF0dXJlcz8uaW5jbHVkZXMoJ2lzcmFjYXJkLWFtZXg6c2tpcEFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uJylcclxuICApIHtcclxuICAgIHJldHVybiBhY2NvdW50c1dpdGhJbmRleDtcclxuICB9XHJcbiAgcmV0dXJuIHJ1blNlcmlhbChhY2NvdW50c1dpdGhJbmRleC5tYXAoKGEsIGkpID0+ICgpID0+IGdldEV4dHJhU2NyYXBBY2NvdW50KHBhZ2UsIG9wdGlvbnMsIGEsIGFsbE1vbnRoc1tpXSkpKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBbGxUcmFuc2FjdGlvbnMoXHJcbiAgcGFnZTogUGFnZSxcclxuICBvcHRpb25zOiBTY3JhcGVyT3B0aW9ucyxcclxuICBjb21wYW55U2VydmljZU9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcclxuICBzdGFydE1vbWVudDogTW9tZW50LFxyXG4pIHtcclxuICBjb25zdCBmdXR1cmVNb250aHNUb1NjcmFwZSA9IG9wdGlvbnMuZnV0dXJlTW9udGhzVG9TY3JhcGUgPz8gMTtcclxuICBjb25zdCBhbGxNb250aHMgPSBnZXRBbGxNb250aE1vbWVudHMoc3RhcnRNb21lbnQsIGZ1dHVyZU1vbnRoc1RvU2NyYXBlKTtcclxuICBjb25zdCByZXN1bHRzOiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXhbXSA9IGF3YWl0IHJ1blNlcmlhbChcclxuICAgIGFsbE1vbnRocy5tYXAobW9udGhNb21lbnQgPT4gKCkgPT4ge1xyXG4gICAgICByZXR1cm4gZmV0Y2hUcmFuc2FjdGlvbnMocGFnZSwgb3B0aW9ucywgY29tcGFueVNlcnZpY2VPcHRpb25zLCBzdGFydE1vbWVudCwgbW9udGhNb21lbnQpO1xyXG4gICAgfSksXHJcbiAgKTtcclxuXHJcbiAgY29uc3QgZmluYWxSZXN1bHQgPSBhd2FpdCBnZXRBZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbihcclxuICAgIG9wdGlvbnMsXHJcbiAgICByZXN1bHRzLFxyXG4gICAgcGFnZSxcclxuICAgIGNvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcclxuICAgIGFsbE1vbnRocyxcclxuICApO1xyXG4gIGNvbnN0IGNvbWJpbmVkVHhuczogUmVjb3JkPHN0cmluZywgVHJhbnNhY3Rpb25bXT4gPSB7fTtcclxuXHJcbiAgZmluYWxSZXN1bHQuZm9yRWFjaChyZXN1bHQgPT4ge1xyXG4gICAgT2JqZWN0LmtleXMocmVzdWx0KS5mb3JFYWNoKGFjY291bnROdW1iZXIgPT4ge1xyXG4gICAgICBsZXQgdHhuc0ZvckFjY291bnQgPSBjb21iaW5lZFR4bnNbYWNjb3VudE51bWJlcl07XHJcbiAgICAgIGlmICghdHhuc0ZvckFjY291bnQpIHtcclxuICAgICAgICB0eG5zRm9yQWNjb3VudCA9IFtdO1xyXG4gICAgICAgIGNvbWJpbmVkVHhuc1thY2NvdW50TnVtYmVyXSA9IHR4bnNGb3JBY2NvdW50O1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHRvQmVBZGRlZFR4bnMgPSByZXN1bHRbYWNjb3VudE51bWJlcl0udHhucztcclxuICAgICAgY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdLnB1c2goLi4udG9CZUFkZGVkVHhucyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgY29uc3QgYWNjb3VudHMgPSBPYmplY3Qua2V5cyhjb21iaW5lZFR4bnMpLm1hcChhY2NvdW50TnVtYmVyID0+IHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGFjY291bnROdW1iZXIsXHJcbiAgICAgIHR4bnM6IGNvbWJpbmVkVHhuc1thY2NvdW50TnVtYmVyXSxcclxuICAgIH07XHJcbiAgfSk7XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgYWNjb3VudHMsXHJcbiAgfTtcclxufVxyXG5cclxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHsgaWQ6IHN0cmluZzsgcGFzc3dvcmQ6IHN0cmluZzsgY2FyZDZEaWdpdHM6IHN0cmluZyB9O1xyXG5jbGFzcyBJc3JhY2FyZEFtZXhCYXNlU2NyYXBlciBleHRlbmRzIEJhc2VTY3JhcGVyV2l0aEJyb3dzZXI8U2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHM+IHtcclxuICBwcml2YXRlIGJhc2VVcmw6IHN0cmluZztcclxuXHJcbiAgcHJpdmF0ZSBjb21wYW55Q29kZTogc3RyaW5nO1xyXG5cclxuICBwcml2YXRlIHNlcnZpY2VzVXJsOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLCBiYXNlVXJsOiBzdHJpbmcsIGNvbXBhbnlDb2RlOiBzdHJpbmcpIHtcclxuICAgIHN1cGVyKG9wdGlvbnMpO1xyXG5cclxuICAgIHRoaXMuYmFzZVVybCA9IGJhc2VVcmw7XHJcbiAgICB0aGlzLmNvbXBhbnlDb2RlID0gY29tcGFueUNvZGU7XHJcbiAgICB0aGlzLnNlcnZpY2VzVXJsID0gYCR7YmFzZVVybH0vc2VydmljZXMvUHJveHlSZXF1ZXN0SGFuZGxlci5hc2h4YDtcclxuICB9XHJcblxyXG4gIGFzeW5jIGxvZ2luKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyk6IFByb21pc2U8U2NyYXBlclNjcmFwaW5nUmVzdWx0PiB7XHJcbiAgICAvLyBBbnRpLWRldGVjdGlvbjogcmVhbGlzdGljIFVBLCBjbGllbnQgaGludHMsIHN0ZWFsdGggSlMg4oCUIG11c3QgcnVuIEJFRk9SRSBuYXZpZ2F0aW9uXHJcbiAgICBhd2FpdCBhcHBseUFudGlEZXRlY3Rpb24odGhpcy5wYWdlKTtcclxuXHJcbiAgICBhd2FpdCB0aGlzLnBhZ2Uuc2V0UmVxdWVzdEludGVyY2VwdGlvbih0cnVlKTtcclxuICAgIHRoaXMucGFnZS5vbigncmVxdWVzdCcsIHJlcXVlc3QgPT4ge1xyXG4gICAgICBpZiAoaXNCb3REZXRlY3Rpb25TY3JpcHQocmVxdWVzdC51cmwoKSkpIHtcclxuICAgICAgICBkZWJ1ZyhgYmxvY2tpbmcgYm90IGRldGVjdGlvbiBzY3JpcHQ6ICR7cmVxdWVzdC51cmwoKX1gKTtcclxuICAgICAgICB2b2lkIHJlcXVlc3QuYWJvcnQodW5kZWZpbmVkLCBpbnRlcmNlcHRpb25Qcmlvcml0aWVzLmFib3J0KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB2b2lkIHJlcXVlc3QuY29udGludWUodW5kZWZpbmVkLCBpbnRlcmNlcHRpb25Qcmlvcml0aWVzLmNvbnRpbnVlKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgZGVidWcoYG5hdmlnYXRpbmcgdG8gJHt0aGlzLmJhc2VVcmx9L3BlcnNvbmFsYXJlYS9Mb2dpbmApO1xyXG4gICAgYXdhaXQgdGhpcy5uYXZpZ2F0ZVRvKGAke3RoaXMuYmFzZVVybH0vcGVyc29uYWxhcmVhL0xvZ2luYCk7XHJcbiAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dnaW5nSW4pO1xyXG5cclxuICAgIGNvbnN0IHZhbGlkYXRlZERhdGEgPSBhd2FpdCB0aGlzLnZhbGlkYXRlQ3JlZGVudGlhbHMoY3JlZGVudGlhbHMpO1xyXG4gICAgaWYgKCF2YWxpZGF0ZWREYXRhKSB7XHJcbiAgICAgIGNvbnN0IHBhZ2VVcmwgPSB0aGlzLnBhZ2UudXJsKCk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbG9naW4gdmFsaWRhdGlvbiBmYWlsZWQgKHBhZ2VVcmw9JHtwYWdlVXJsfSkuIFBvc3NpYmxlIFdBRiBibG9jay5gKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB2YWxpZGF0ZVJldHVybkNvZGUgPSB2YWxpZGF0ZWREYXRhLnJldHVybkNvZGU7XHJcbiAgICBkZWJ1ZyhgdXNlciB2YWxpZGF0ZSB3aXRoIHJldHVybiBjb2RlICcke3ZhbGlkYXRlUmV0dXJuQ29kZX0nYCk7XHJcbiAgICBpZiAodmFsaWRhdGVSZXR1cm5Db2RlID09PSAnMScpIHtcclxuICAgICAgY29uc3QgeyB1c2VyTmFtZSB9ID0gdmFsaWRhdGVkRGF0YTtcclxuXHJcbiAgICAgIGNvbnN0IGxvZ2luVXJsID0gYCR7dGhpcy5zZXJ2aWNlc1VybH0/cmVxTmFtZT1wZXJmb3JtTG9nb25JYDtcclxuICAgICAgY29uc3QgcmVxdWVzdCA9IHtcclxuICAgICAgICBLb2RNaXNodGFtZXNoOiB1c2VyTmFtZSxcclxuICAgICAgICBNaXNwYXJaaWh1eTogY3JlZGVudGlhbHMuaWQsXHJcbiAgICAgICAgU2lzbWE6IGNyZWRlbnRpYWxzLnBhc3N3b3JkLFxyXG4gICAgICAgIGNhcmRTdWZmaXg6IGNyZWRlbnRpYWxzLmNhcmQ2RGlnaXRzLFxyXG4gICAgICAgIGNvdW50cnlDb2RlOiBDT1VOVFJZX0NPREUsXHJcbiAgICAgICAgaWRUeXBlOiBJRF9UWVBFLFxyXG4gICAgICB9O1xyXG4gICAgICBkZWJ1ZygndXNlciBsb2dpbiBzdGFydGVkJyk7XHJcbiAgICAgIGNvbnN0IGxvZ2luUmVzdWx0ID0gYXdhaXQgZmV0Y2hQb3N0V2l0aGluUGFnZTx7IHN0YXR1czogc3RyaW5nIH0+KHRoaXMucGFnZSwgbG9naW5VcmwsIHJlcXVlc3QpO1xyXG4gICAgICBkZWJ1ZyhgdXNlciBsb2dpbiB3aXRoIHN0YXR1cyAnJHtsb2dpblJlc3VsdD8uc3RhdHVzfSdgLCBsb2dpblJlc3VsdCk7XHJcblxyXG4gICAgICBpZiAobG9naW5SZXN1bHQgJiYgbG9naW5SZXN1bHQuc3RhdHVzID09PSAnMScpIHtcclxuICAgICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dpblN1Y2Nlc3MpO1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGxvZ2luUmVzdWx0ICYmIGxvZ2luUmVzdWx0LnN0YXR1cyA9PT0gJzMnKSB7XHJcbiAgICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NyYXBlclByb2dyZXNzVHlwZXMuQ2hhbmdlUGFzc3dvcmQpO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yVHlwZTogU2NyYXBlckVycm9yVHlwZXMuQ2hhbmdlUGFzc3dvcmQsXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NyYXBlclByb2dyZXNzVHlwZXMuTG9naW5GYWlsZWQpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yVHlwZTogU2NyYXBlckVycm9yVHlwZXMuSW52YWxpZFBhc3N3b3JkLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh2YWxpZGF0ZVJldHVybkNvZGUgPT09ICc0Jykge1xyXG4gICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5DaGFuZ2VQYXNzd29yZCk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3JUeXBlOiBTY3JhcGVyRXJyb3JUeXBlcy5DaGFuZ2VQYXNzd29yZCxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dpbkZhaWxlZCk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgZXJyb3JUeXBlOiBTY3JhcGVyRXJyb3JUeXBlcy5JbnZhbGlkUGFzc3dvcmQsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZUNyZWRlbnRpYWxzKFxyXG4gICAgY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzLFxyXG4gICk6IFByb21pc2U8eyB1c2VyTmFtZT86IHN0cmluZzsgcmV0dXJuQ29kZTogc3RyaW5nIH0gfCBudWxsPiB7XHJcbiAgICBjb25zdCB2YWxpZGF0ZVVybCA9IGAke3RoaXMuc2VydmljZXNVcmx9P3JlcU5hbWU9VmFsaWRhdGVJZERhdGFgO1xyXG4gICAgY29uc3QgdmFsaWRhdGVSZXF1ZXN0ID0ge1xyXG4gICAgICBpZDogY3JlZGVudGlhbHMuaWQsXHJcbiAgICAgIGNhcmRTdWZmaXg6IGNyZWRlbnRpYWxzLmNhcmQ2RGlnaXRzLFxyXG4gICAgICBjb3VudHJ5Q29kZTogQ09VTlRSWV9DT0RFLFxyXG4gICAgICBpZFR5cGU6IElEX1RZUEUsXHJcbiAgICAgIGNoZWNrTGV2ZWw6ICcxJyxcclxuICAgICAgY29tcGFueUNvZGU6IHRoaXMuY29tcGFueUNvZGUsXHJcbiAgICB9O1xyXG4gICAgZGVidWcoJ3ZhbGlkYXRpbmcgY3JlZGVudGlhbHMnKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZldGNoUG9zdFdpdGhpblBhZ2U8U2NyYXBlZExvZ2luVmFsaWRhdGlvbj4odGhpcy5wYWdlLCB2YWxpZGF0ZVVybCwgdmFsaWRhdGVSZXF1ZXN0KTtcclxuICAgIGlmICghcmVzdWx0Py5IZWFkZXIgfHwgcmVzdWx0LkhlYWRlci5TdGF0dXMgIT09ICcxJyB8fCAhcmVzdWx0LlZhbGlkYXRlSWREYXRhQmVhbikgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gcmVzdWx0LlZhbGlkYXRlSWREYXRhQmVhbjtcclxuICB9XHJcblxyXG4gIGFzeW5jIGZldGNoRGF0YSgpIHtcclxuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpO1xyXG4gICAgY29uc3Qgc3RhcnREYXRlID0gdGhpcy5vcHRpb25zLnN0YXJ0RGF0ZSB8fCBkZWZhdWx0U3RhcnRNb21lbnQudG9EYXRlKCk7XHJcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoZGVmYXVsdFN0YXJ0TW9tZW50LCBtb21lbnQoc3RhcnREYXRlKSk7XHJcblxyXG4gICAgcmV0dXJuIGZldGNoQWxsVHJhbnNhY3Rpb25zKFxyXG4gICAgICB0aGlzLnBhZ2UsXHJcbiAgICAgIHRoaXMub3B0aW9ucyxcclxuICAgICAge1xyXG4gICAgICAgIHNlcnZpY2VzVXJsOiB0aGlzLnNlcnZpY2VzVXJsLFxyXG4gICAgICAgIGNvbXBhbnlDb2RlOiB0aGlzLmNvbXBhbnlDb2RlLFxyXG4gICAgICB9LFxyXG4gICAgICBzdGFydE1vbWVudCxcclxuICAgICk7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBJc3JhY2FyZEFtZXhCYXNlU2NyYXBlcjtcclxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxJQUFBQSxPQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxPQUFBLEdBQUFGLHNCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBRSxVQUFBLEdBQUFGLE9BQUE7QUFDQSxJQUFBRyxZQUFBLEdBQUFILE9BQUE7QUFDQSxJQUFBSSxNQUFBLEdBQUFMLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSyxNQUFBLEdBQUFMLE9BQUE7QUFDQSxJQUFBTSxNQUFBLEdBQUFOLE9BQUE7QUFDQSxJQUFBTyxhQUFBLEdBQUFQLE9BQUE7QUFDQSxJQUFBUSxRQUFBLEdBQUFSLE9BQUE7QUFDQSxJQUFBUyxjQUFBLEdBQUFULE9BQUE7QUFPQSxJQUFBVSx1QkFBQSxHQUFBVixPQUFBO0FBQ0EsSUFBQVcsT0FBQSxHQUFBWCxPQUFBO0FBRUEsSUFBQVksUUFBQSxHQUFBWixPQUFBO0FBQXNHLFNBQUFELHVCQUFBYyxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBRXRHLE1BQU1HLFVBQVUsR0FBRztFQUNqQkMsYUFBYSxFQUFFLElBQUk7RUFDbkJD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QU8sRUFBRSxLQUFLO01BQ2R5QyxTQUFTLEVBQUVDLHlCQUFpQixDQUFDRTtJQUMvQixDQUFDO0VBQ0g7RUFFQSxNQUFjdkIsbUJBQW1CQSxDQUMvQmQsV0FBdUMsRUFDb0I7SUFDM0QsTUFBTXNDLFdBQVcsR0FBRyxHQUFHLElBQUksQ0FBQ2xNLFdBQVcseUJBQXlCO0lBQ2hFLE1BQU1tTSxlQUFlLEdBQUc7TUFDdEJoQixFQUFFLEVBQUV2QixXQUFXLENBQUN1QixFQUFFO01BQ2xCRyxVQUFVLEVBQUUxQixXQUFXLENBQUMyQixXQUFXO01BQ25DQyxXQUFXLEVBQUUvTCxZQUFZO01BQ3pCZ00sTUFBTSxFQUFFL0wsT0FBTztNQUNmME0sVUFBVSxFQUFFLEdBQUc7TUFDZjFDLFdBQVcsRUFBRSxJQUFJLENBQUNBO0lBQ3BCLENBQUM7SUFDRDdKLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQztJQUMvQixNQUFNc0UsTUFBTSxHQUFHLE1BQU0sSUFBQXdILDBCQUFtQixFQUF5QixJQUFJLENBQUNqTCxJQUFJLEVBQUV3TCxXQUFXLEVBQUVDLGVBQWUsQ0FBQztJQUN6RyxJQUFJLENBQUNoSSxNQUFNLEVBQUVrSSxNQUFNLElBQUlsSSxNQUFNLENBQUNrSSxNQUFNLENBQUNDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQ25JLE1BQU0sQ0FBQ29JLGtCQUFrQixFQUFFLE9BQU8sSUFBSTtJQUM5RixPQUFPcEksTUFBTSxDQUFDb0ksa0JBQWtCO0VBQ2xDO0VBRUEsTUFBTUMsU0FBU0EsQ0FBQSxFQUFHO0lBQ2hCLE1BQU1DLGtCQUFrQixHQUFHLElBQUEvSyxlQUFNLEVBQUMsQ0FBQyxDQUFDZ0wsUUFBUSxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUM7SUFDeEQsTUFBTUMsU0FBUyxHQUFHLElBQUksQ0FBQ3RKLE9BQU8sQ0FBQ3NKLFNBQVMsSUFBSUYsa0JBQWtCLENBQUNHLE1BQU0sQ0FBQyxDQUFDO0lBQ3ZFLE1BQU0vRyxXQUFXLEdBQUduRSxlQUFNLENBQUNtTCxHQUFHLENBQUNKLGtCQUFrQixFQUFFLElBQUEvSyxlQUFNLEVBQUNpTCxTQUFTLENBQUMsQ0FBQztJQUVyRSxPQUFPL0Qsb0JBQW9CLENBQ3pCLElBQUksQ0FBQ2xJLElBQUksRUFDVCxJQUFJLENBQUMyQyxPQUFPLEVBQ1o7TUFDRXJELFdBQVcsRUFBRSxJQUFJLENBQUNBLFdBQVc7TUFDN0IwSixXQUFXLEVBQUUsSUFBSSxDQUFDQTtJQUNwQixDQUFDLEVBQ0Q3RCxXQUNGLENBQUM7RUFDSDtBQUNGO0FBQUMsSUFBQWlILFFBQUEsR0FBQUMsT0FBQSxDQUFBMU4sT0FBQSxHQUVjaUssdUJBQXVCIiwiaWdub3JlTGlzdCI6W119