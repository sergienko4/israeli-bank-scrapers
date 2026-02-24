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
    const validateResult = await this.validateCredentials(credentials);
    if (!validateResult) {
      const pageUrl = this.page.url();
      throw new Error(`login validation failed (pageUrl=${pageUrl}). Possible WAF block.`);
    }
    const validatedData = validateResult.ValidateIdDataBean;
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
    return result;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbG9kYXNoIiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfbW9tZW50IiwiX2NvbnN0YW50cyIsIl9kZWZpbml0aW9ucyIsIl9kYXRlcyIsIl9kZWJ1ZyIsIl9mZXRjaCIsIl90cmFuc2FjdGlvbnMiLCJfd2FpdGluZyIsIl90cmFuc2FjdGlvbnMyIiwiX2Jhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJfZXJyb3JzIiwiX2Jyb3dzZXIiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJSQVRFX0xJTUlUIiwiU0xFRVBfQkVUV0VFTiIsIlRSQU5TQUNUSU9OU19CQVRDSF9TSVpFIiwiQ09VTlRSWV9DT0RFIiwiSURfVFlQRSIsIklOU1RBTExNRU5UU19LRVlXT1JEIiwiREFURV9GT1JNQVQiLCJkZWJ1ZyIsImdldERlYnVnIiwiZ2V0QWNjb3VudHNVcmwiLCJzZXJ2aWNlc1VybCIsIm1vbnRoTW9tZW50IiwiYmlsbGluZ0RhdGUiLCJmb3JtYXQiLCJ1cmwiLCJVUkwiLCJzZWFyY2hQYXJhbXMiLCJzZXQiLCJ0b1N0cmluZyIsImZldGNoQWNjb3VudHMiLCJwYWdlIiwiZGF0YVVybCIsImRhdGFSZXN1bHQiLCJmZXRjaEdldFdpdGhpblBhZ2UiLCJfIiwiZ2V0IiwiRGFzaGJvYXJkTW9udGhCZWFuIiwiY2FyZHNDaGFyZ2VzIiwibWFwIiwiY2FyZENoYXJnZSIsImluZGV4IiwicGFyc2VJbnQiLCJjYXJkSW5kZXgiLCJhY2NvdW50TnVtYmVyIiwiY2FyZE51bWJlciIsInByb2Nlc3NlZERhdGUiLCJtb21lbnQiLCJ0b0lTT1N0cmluZyIsImdldFRyYW5zYWN0aW9uc1VybCIsIm1vbnRoIiwieWVhciIsIm1vbnRoU3RyIiwiY29udmVydEN1cnJlbmN5IiwiY3VycmVuY3lTdHIiLCJTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCIsIkFMVF9TSEVLRUxfQ1VSUkVOQ1kiLCJTSEVLRUxfQ1VSUkVOQ1kiLCJnZXRJbnN0YWxsbWVudHNJbmZvIiwidHhuIiwibW9yZUluZm8iLCJpbmNsdWRlcyIsInVuZGVmaW5lZCIsIm1hdGNoZXMiLCJtYXRjaCIsImxlbmd0aCIsIm51bWJlciIsInRvdGFsIiwiZ2V0VHJhbnNhY3Rpb25UeXBlIiwiVHJhbnNhY3Rpb25UeXBlcyIsIkluc3RhbGxtZW50cyIsIk5vcm1hbCIsImNvbnZlcnRUcmFuc2FjdGlvbnMiLCJ0eG5zIiwib3B0aW9ucyIsImZpbHRlcmVkVHhucyIsImZpbHRlciIsImRlYWxTdW1UeXBlIiwidm91Y2hlck51bWJlclJhdHoiLCJ2b3VjaGVyTnVtYmVyUmF0ek91dGJvdW5kIiwiaXNPdXRib3VuZCIsImRlYWxTdW1PdXRib3VuZCIsInR4bkRhdGVTdHIiLCJmdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQiLCJmdWxsUHVyY2hhc2VEYXRlIiwidHhuTW9tZW50IiwiY3VycmVudFByb2Nlc3NlZERhdGUiLCJmdWxsUGF5bWVudERhdGUiLCJyZXN1bHQiLCJ0eXBlIiwiaWRlbnRpZmllciIsImRhdGUiLCJvcmlnaW5hbEFtb3VudCIsImRlYWxTdW0iLCJvcmlnaW5hbEN1cnJlbmN5IiwiY3VycmVudFBheW1lbnRDdXJyZW5jeSIsImN1cnJlbmN5SWQiLCJjaGFyZ2VkQW1vdW50IiwicGF5bWVudFN1bU91dGJvdW5kIiwicGF5bWVudFN1bSIsImNoYXJnZWRDdXJyZW5jeSIsImRlc2NyaXB0aW9uIiwiZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kIiwiZnVsbFN1cHBsaWVyTmFtZUhlYiIsIm1lbW8iLCJpbnN0YWxsbWVudHMiLCJzdGF0dXMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiQ29tcGxldGVkIiwiaW5jbHVkZVJhd1RyYW5zYWN0aW9uIiwicmF3VHJhbnNhY3Rpb24iLCJnZXRSYXdUcmFuc2FjdGlvbiIsImZldGNoVHJhbnNhY3Rpb25zIiwiY29tcGFueVNlcnZpY2VPcHRpb25zIiwic3RhcnRNb21lbnQiLCJhY2NvdW50cyIsInNsZWVwIiwiQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbiIsImFjY291bnRUeG5zIiwiZm9yRWFjaCIsImFjY291bnQiLCJ0eG5Hcm91cHMiLCJhbGxUeG5zIiwidHhuR3JvdXAiLCJ0eG5Jc3JhZWwiLCJwdXNoIiwidHhuQWJyb2FkIiwiY29tYmluZUluc3RhbGxtZW50cyIsImZpeEluc3RhbGxtZW50cyIsIm91dHB1dERhdGEiLCJlbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUiLCJmaWx0ZXJPbGRUcmFuc2FjdGlvbnMiLCJnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24iLCJhY2NvdW50SW5kZXgiLCJ0cmFuc2FjdGlvbiIsImRhdGEiLCJyYXdDYXRlZ29yeSIsImNhdGVnb3J5IiwidHJpbSIsImdldEV4dHJhU2NyYXBBY2NvdW50IiwiYWNjb3VudE1hcCIsIk9iamVjdCIsInZhbHVlcyIsInR4bnNDaHVuayIsImNodW5rIiwidXBkYXRlZFR4bnMiLCJQcm9taXNlIiwiYWxsIiwidCIsInJlZHVjZSIsIm0iLCJ4IiwiZ2V0QWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24iLCJzY3JhcGVyT3B0aW9ucyIsImFjY291bnRzV2l0aEluZGV4IiwiYWxsTW9udGhzIiwiYWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24iLCJvcHRJbkZlYXR1cmVzIiwicnVuU2VyaWFsIiwiYSIsImkiLCJmZXRjaEFsbFRyYW5zYWN0aW9ucyIsImZ1dHVyZU1vbnRoc1RvU2NyYXBlIiwiZ2V0QWxsTW9udGhNb21lbnRzIiwicmVzdWx0cyIsImZpbmFsUmVzdWx0IiwiY29tYmluZWRUeG5zIiwia2V5cyIsInR4bnNGb3JBY2NvdW50IiwidG9CZUFkZGVkVHhucyIsInN1Y2Nlc3MiLCJJc3JhY2FyZEFtZXhCYXNlU2NyYXBlciIsIkJhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJjb25zdHJ1Y3RvciIsImJhc2VVcmwiLCJjb21wYW55Q29kZSIsImxvZ2luIiwiY3JlZGVudGlhbHMiLCJhcHBseUFudGlEZXRlY3Rpb24iLCJzZXRSZXF1ZXN0SW50ZXJjZXB0aW9uIiwib24iLCJyZXF1ZXN0IiwiaXNCb3REZXRlY3Rpb25TY3JpcHQiLCJhYm9ydCIsImludGVyY2VwdGlvblByaW9yaXRpZXMiLCJjb250aW51ZSIsIm5hdmlnYXRlVG8iLCJlbWl0UHJvZ3Jlc3MiLCJTY3JhcGVyUHJvZ3Jlc3NUeXBlcyIsIkxvZ2dpbmdJbiIsInZhbGlkYXRlUmVzdWx0IiwidmFsaWRhdGVDcmVkZW50aWFscyIsInBhZ2VVcmwiLCJFcnJvciIsInZhbGlkYXRlZERhdGEiLCJWYWxpZGF0ZUlkRGF0YUJlYW4iLCJ2YWxpZGF0ZVJldHVybkNvZGUiLCJyZXR1cm5Db2RlIiwidXNlck5hbWUiLCJsb2dpblVybCIsIktvZE1pc2h0YW1lc2giLCJNaXNwYXJaaWh1eSIsImlkIiwiU2lzbWEiLCJwYXNzd29yZCIsImNhcmRTdWZmaXgiLCJjYXJkNkRpZ2l0cyIsImNvdW50cnlDb2RlIiwiaWRUeXBlIiwibG9naW5SZXN1bHQiLCJmZXRjaFBvc3RXaXRoaW5QYWdlIiwiTG9naW5TdWNjZXNzIiwiQ2hhbmdlUGFzc3dvcmQiLCJlcnJvclR5cGUiLCJTY3JhcGVyRXJyb3JUeXBlcyIsIkxvZ2luRmFpbGVkIiwiSW52YWxpZFBhc3N3b3JkIiwidmFsaWRhdGVVcmwiLCJ2YWxpZGF0ZVJlcXVlc3QiLCJjaGVja0xldmVsIiwiSGVhZGVyIiwiU3RhdHVzIiwiZmV0Y2hEYXRhIiwiZGVmYXVsdFN0YXJ0TW9tZW50Iiwic3VidHJhY3QiLCJzdGFydERhdGUiLCJ0b0RhdGUiLCJtYXgiLCJfZGVmYXVsdCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvc2NyYXBlcnMvYmFzZS1pc3JhY2FyZC1hbWV4LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XHJcbmltcG9ydCBtb21lbnQsIHsgdHlwZSBNb21lbnQgfSBmcm9tICdtb21lbnQnO1xyXG5pbXBvcnQgeyB0eXBlIFBhZ2UgfSBmcm9tICdwdXBwZXRlZXInO1xyXG5pbXBvcnQgeyBBTFRfU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1ksIFNIRUtFTF9DVVJSRU5DWV9LRVlXT1JEIH0gZnJvbSAnLi4vY29uc3RhbnRzJztcclxuaW1wb3J0IHsgU2NyYXBlclByb2dyZXNzVHlwZXMgfSBmcm9tICcuLi9kZWZpbml0aW9ucyc7XHJcbmltcG9ydCBnZXRBbGxNb250aE1vbWVudHMgZnJvbSAnLi4vaGVscGVycy9kYXRlcyc7XHJcbmltcG9ydCB7IGdldERlYnVnIH0gZnJvbSAnLi4vaGVscGVycy9kZWJ1Zyc7XHJcbmltcG9ydCB7IGZldGNoR2V0V2l0aGluUGFnZSwgZmV0Y2hQb3N0V2l0aGluUGFnZSB9IGZyb20gJy4uL2hlbHBlcnMvZmV0Y2gnO1xyXG5pbXBvcnQgeyBmaWx0ZXJPbGRUcmFuc2FjdGlvbnMsIGZpeEluc3RhbGxtZW50cywgZ2V0UmF3VHJhbnNhY3Rpb24gfSBmcm9tICcuLi9oZWxwZXJzL3RyYW5zYWN0aW9ucyc7XHJcbmltcG9ydCB7IHJ1blNlcmlhbCwgc2xlZXAgfSBmcm9tICcuLi9oZWxwZXJzL3dhaXRpbmcnO1xyXG5pbXBvcnQge1xyXG4gIFRyYW5zYWN0aW9uU3RhdHVzZXMsXHJcbiAgVHJhbnNhY3Rpb25UeXBlcyxcclxuICB0eXBlIFRyYW5zYWN0aW9uLFxyXG4gIHR5cGUgVHJhbnNhY3Rpb25JbnN0YWxsbWVudHMsXHJcbiAgdHlwZSBUcmFuc2FjdGlvbnNBY2NvdW50LFxyXG59IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XHJcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIgfSBmcm9tICcuL2Jhc2Utc2NyYXBlci13aXRoLWJyb3dzZXInO1xyXG5pbXBvcnQgeyBTY3JhcGVyRXJyb3JUeXBlcyB9IGZyb20gJy4vZXJyb3JzJztcclxuaW1wb3J0IHsgdHlwZSBTY3JhcGVyT3B0aW9ucywgdHlwZSBTY3JhcGVyU2NyYXBpbmdSZXN1bHQgfSBmcm9tICcuL2ludGVyZmFjZSc7XHJcbmltcG9ydCB7IGFwcGx5QW50aURldGVjdGlvbiwgaW50ZXJjZXB0aW9uUHJpb3JpdGllcywgaXNCb3REZXRlY3Rpb25TY3JpcHQgfSBmcm9tICcuLi9oZWxwZXJzL2Jyb3dzZXInO1xyXG5cclxuY29uc3QgUkFURV9MSU1JVCA9IHtcclxuICBTTEVFUF9CRVRXRUVOOiAxMDAwLFxyXG4gIFRSQU5TQUNUSU9OU19CQVRDSF9TSVpFOiAxMCxcclxufSBhcyBjb25zdDtcclxuXHJcbmNvbnN0IENPVU5UUllfQ09ERSA9ICcyMTInO1xyXG5jb25zdCBJRF9UWVBFID0gJzEnO1xyXG5jb25zdCBJTlNUQUxMTUVOVFNfS0VZV09SRCA9ICfXqtep15zXldedJztcclxuXHJcbmNvbnN0IERBVEVfRk9STUFUID0gJ0REL01NL1lZWVknO1xyXG5cclxuY29uc3QgZGVidWcgPSBnZXREZWJ1ZygnYmFzZS1pc3JhY2FyZC1hbWV4Jyk7XHJcblxyXG50eXBlIENvbXBhbnlTZXJ2aWNlT3B0aW9ucyA9IHtcclxuICBzZXJ2aWNlc1VybDogc3RyaW5nO1xyXG4gIGNvbXBhbnlDb2RlOiBzdHJpbmc7XHJcbn07XHJcblxyXG50eXBlIFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleCA9IFJlY29yZDxzdHJpbmcsIFRyYW5zYWN0aW9uc0FjY291bnQgJiB7IGluZGV4OiBudW1iZXIgfT47XHJcblxyXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uIHtcclxuICBkZWFsU3VtVHlwZTogc3RyaW5nO1xyXG4gIHZvdWNoZXJOdW1iZXJSYXR6T3V0Ym91bmQ6IHN0cmluZztcclxuICB2b3VjaGVyTnVtYmVyUmF0ejogc3RyaW5nO1xyXG4gIG1vcmVJbmZvPzogc3RyaW5nO1xyXG4gIGRlYWxTdW1PdXRib3VuZDogYm9vbGVhbjtcclxuICBjdXJyZW5jeUlkOiBzdHJpbmc7XHJcbiAgY3VycmVudFBheW1lbnRDdXJyZW5jeTogc3RyaW5nO1xyXG4gIGRlYWxTdW06IG51bWJlcjtcclxuICBmdWxsUGF5bWVudERhdGU/OiBzdHJpbmc7XHJcbiAgZnVsbFB1cmNoYXNlRGF0ZT86IHN0cmluZztcclxuICBmdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQ/OiBzdHJpbmc7XHJcbiAgZnVsbFN1cHBsaWVyTmFtZUhlYjogc3RyaW5nO1xyXG4gIGZ1bGxTdXBwbGllck5hbWVPdXRib3VuZDogc3RyaW5nO1xyXG4gIHBheW1lbnRTdW06IG51bWJlcjtcclxuICBwYXltZW50U3VtT3V0Ym91bmQ6IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIFNjcmFwZWRBY2NvdW50IHtcclxuICBpbmRleDogbnVtYmVyO1xyXG4gIGFjY291bnROdW1iZXI6IHN0cmluZztcclxuICBwcm9jZXNzZWREYXRlOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBTY3JhcGVkTG9naW5WYWxpZGF0aW9uIHtcclxuICBIZWFkZXI6IHtcclxuICAgIFN0YXR1czogc3RyaW5nO1xyXG4gIH07XHJcbiAgVmFsaWRhdGVJZERhdGFCZWFuPzoge1xyXG4gICAgdXNlck5hbWU/OiBzdHJpbmc7XHJcbiAgICByZXR1cm5Db2RlOiBzdHJpbmc7XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFNjcmFwZWRBY2NvdW50c1dpdGhpblBhZ2VSZXNwb25zZSB7XHJcbiAgSGVhZGVyOiB7XHJcbiAgICBTdGF0dXM6IHN0cmluZztcclxuICB9O1xyXG4gIERhc2hib2FyZE1vbnRoQmVhbj86IHtcclxuICAgIGNhcmRzQ2hhcmdlczoge1xyXG4gICAgICBjYXJkSW5kZXg6IHN0cmluZztcclxuICAgICAgY2FyZE51bWJlcjogc3RyaW5nO1xyXG4gICAgICBiaWxsaW5nRGF0ZTogc3RyaW5nO1xyXG4gICAgfVtdO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBTY3JhcGVkQ3VycmVudENhcmRUcmFuc2FjdGlvbnMge1xyXG4gIHR4bklzcmFlbD86IFNjcmFwZWRUcmFuc2FjdGlvbltdO1xyXG4gIHR4bkFicm9hZD86IFNjcmFwZWRUcmFuc2FjdGlvbltdO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uRGF0YSB7XHJcbiAgSGVhZGVyPzoge1xyXG4gICAgU3RhdHVzOiBzdHJpbmc7XHJcbiAgfTtcclxuICBQaXJ0ZXlJc2thXzIwNEJlYW4/OiB7XHJcbiAgICBzZWN0b3I6IHN0cmluZztcclxuICB9O1xyXG5cclxuICBDYXJkc1RyYW5zYWN0aW9uc0xpc3RCZWFuPzogUmVjb3JkPFxyXG4gICAgc3RyaW5nLFxyXG4gICAge1xyXG4gICAgICBDdXJyZW50Q2FyZFRyYW5zYWN0aW9uczogU2NyYXBlZEN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zW107XHJcbiAgICB9XHJcbiAgPjtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0QWNjb3VudHNVcmwoc2VydmljZXNVcmw6IHN0cmluZywgbW9udGhNb21lbnQ6IE1vbWVudCkge1xyXG4gIGNvbnN0IGJpbGxpbmdEYXRlID0gbW9udGhNb21lbnQuZm9ybWF0KCdZWVlZLU1NLUREJyk7XHJcbiAgY29uc3QgdXJsID0gbmV3IFVSTChzZXJ2aWNlc1VybCk7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3JlcU5hbWUnLCAnRGFzaGJvYXJkTW9udGgnKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnYWN0aW9uQ29kZScsICcwJyk7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2JpbGxpbmdEYXRlJywgYmlsbGluZ0RhdGUpO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdmb3JtYXQnLCAnSnNvbicpO1xyXG4gIHJldHVybiB1cmwudG9TdHJpbmcoKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50cyhwYWdlOiBQYWdlLCBzZXJ2aWNlc1VybDogc3RyaW5nLCBtb250aE1vbWVudDogTW9tZW50KTogUHJvbWlzZTxTY3JhcGVkQWNjb3VudFtdPiB7XHJcbiAgY29uc3QgZGF0YVVybCA9IGdldEFjY291bnRzVXJsKHNlcnZpY2VzVXJsLCBtb250aE1vbWVudCk7XHJcbiAgZGVidWcoYGZldGNoaW5nIGFjY291bnRzIGZyb20gJHtkYXRhVXJsfWApO1xyXG4gIGNvbnN0IGRhdGFSZXN1bHQgPSBhd2FpdCBmZXRjaEdldFdpdGhpblBhZ2U8U2NyYXBlZEFjY291bnRzV2l0aGluUGFnZVJlc3BvbnNlPihwYWdlLCBkYXRhVXJsKTtcclxuICBpZiAoZGF0YVJlc3VsdCAmJiBfLmdldChkYXRhUmVzdWx0LCAnSGVhZGVyLlN0YXR1cycpID09PSAnMScgJiYgZGF0YVJlc3VsdC5EYXNoYm9hcmRNb250aEJlYW4pIHtcclxuICAgIGNvbnN0IHsgY2FyZHNDaGFyZ2VzIH0gPSBkYXRhUmVzdWx0LkRhc2hib2FyZE1vbnRoQmVhbjtcclxuICAgIGlmIChjYXJkc0NoYXJnZXMpIHtcclxuICAgICAgcmV0dXJuIGNhcmRzQ2hhcmdlcy5tYXAoY2FyZENoYXJnZSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGluZGV4OiBwYXJzZUludChjYXJkQ2hhcmdlLmNhcmRJbmRleCwgMTApLFxyXG4gICAgICAgICAgYWNjb3VudE51bWJlcjogY2FyZENoYXJnZS5jYXJkTnVtYmVyLFxyXG4gICAgICAgICAgcHJvY2Vzc2VkRGF0ZTogbW9tZW50KGNhcmRDaGFyZ2UuYmlsbGluZ0RhdGUsIERBVEVfRk9STUFUKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gW107XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc1VybChzZXJ2aWNlc1VybDogc3RyaW5nLCBtb250aE1vbWVudDogTW9tZW50KSB7XHJcbiAgY29uc3QgbW9udGggPSBtb250aE1vbWVudC5tb250aCgpICsgMTtcclxuICBjb25zdCB5ZWFyID0gbW9udGhNb21lbnQueWVhcigpO1xyXG4gIGNvbnN0IG1vbnRoU3RyID0gbW9udGggPCAxMCA/IGAwJHttb250aH1gIDogbW9udGgudG9TdHJpbmcoKTtcclxuICBjb25zdCB1cmwgPSBuZXcgVVJMKHNlcnZpY2VzVXJsKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgncmVxTmFtZScsICdDYXJkc1RyYW5zYWN0aW9uc0xpc3QnKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnbW9udGgnLCBtb250aFN0cik7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3llYXInLCBgJHt5ZWFyfWApO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdyZXF1aXJlZERhdGUnLCAnTicpO1xyXG4gIHJldHVybiB1cmwudG9TdHJpbmcoKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29udmVydEN1cnJlbmN5KGN1cnJlbmN5U3RyOiBzdHJpbmcpIHtcclxuICBpZiAoY3VycmVuY3lTdHIgPT09IFNIRUtFTF9DVVJSRU5DWV9LRVlXT1JEIHx8IGN1cnJlbmN5U3RyID09PSBBTFRfU0hFS0VMX0NVUlJFTkNZKSB7XHJcbiAgICByZXR1cm4gU0hFS0VMX0NVUlJFTkNZO1xyXG4gIH1cclxuICByZXR1cm4gY3VycmVuY3lTdHI7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldEluc3RhbGxtZW50c0luZm8odHhuOiBTY3JhcGVkVHJhbnNhY3Rpb24pOiBUcmFuc2FjdGlvbkluc3RhbGxtZW50cyB8IHVuZGVmaW5lZCB7XHJcbiAgaWYgKCF0eG4ubW9yZUluZm8gfHwgIXR4bi5tb3JlSW5mby5pbmNsdWRlcyhJTlNUQUxMTUVOVFNfS0VZV09SRCkpIHtcclxuICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgfVxyXG4gIGNvbnN0IG1hdGNoZXMgPSB0eG4ubW9yZUluZm8ubWF0Y2goL1xcZCsvZyk7XHJcbiAgaWYgKCFtYXRjaGVzIHx8IG1hdGNoZXMubGVuZ3RoIDwgMikge1xyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICB9XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBudW1iZXI6IHBhcnNlSW50KG1hdGNoZXNbMF0sIDEwKSxcclxuICAgIHRvdGFsOiBwYXJzZUludChtYXRjaGVzWzFdLCAxMCksXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25UeXBlKHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKSB7XHJcbiAgcmV0dXJuIGdldEluc3RhbGxtZW50c0luZm8odHhuKSA/IFRyYW5zYWN0aW9uVHlwZXMuSW5zdGFsbG1lbnRzIDogVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbnZlcnRUcmFuc2FjdGlvbnMoXHJcbiAgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sXHJcbiAgcHJvY2Vzc2VkRGF0ZTogc3RyaW5nLFxyXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcclxuKTogVHJhbnNhY3Rpb25bXSB7XHJcbiAgY29uc3QgZmlsdGVyZWRUeG5zID0gdHhucy5maWx0ZXIoXHJcbiAgICB0eG4gPT5cclxuICAgICAgdHhuLmRlYWxTdW1UeXBlICE9PSAnMScgJiYgdHhuLnZvdWNoZXJOdW1iZXJSYXR6ICE9PSAnMDAwMDAwMDAwJyAmJiB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCAhPT0gJzAwMDAwMDAwMCcsXHJcbiAgKTtcclxuXHJcbiAgcmV0dXJuIGZpbHRlcmVkVHhucy5tYXAodHhuID0+IHtcclxuICAgIGNvbnN0IGlzT3V0Ym91bmQgPSB0eG4uZGVhbFN1bU91dGJvdW5kO1xyXG4gICAgY29uc3QgdHhuRGF0ZVN0ciA9IGlzT3V0Ym91bmQgPyB0eG4uZnVsbFB1cmNoYXNlRGF0ZU91dGJvdW5kIDogdHhuLmZ1bGxQdXJjaGFzZURhdGU7XHJcbiAgICBjb25zdCB0eG5Nb21lbnQgPSBtb21lbnQodHhuRGF0ZVN0ciwgREFURV9GT1JNQVQpO1xyXG5cclxuICAgIGNvbnN0IGN1cnJlbnRQcm9jZXNzZWREYXRlID0gdHhuLmZ1bGxQYXltZW50RGF0ZVxyXG4gICAgICA/IG1vbWVudCh0eG4uZnVsbFBheW1lbnREYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKVxyXG4gICAgICA6IHByb2Nlc3NlZERhdGU7XHJcbiAgICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uID0ge1xyXG4gICAgICB0eXBlOiBnZXRUcmFuc2FjdGlvblR5cGUodHhuKSxcclxuICAgICAgaWRlbnRpZmllcjogcGFyc2VJbnQoaXNPdXRib3VuZCA/IHR4bi52b3VjaGVyTnVtYmVyUmF0ek91dGJvdW5kIDogdHhuLnZvdWNoZXJOdW1iZXJSYXR6LCAxMCksXHJcbiAgICAgIGRhdGU6IHR4bk1vbWVudC50b0lTT1N0cmluZygpLFxyXG4gICAgICBwcm9jZXNzZWREYXRlOiBjdXJyZW50UHJvY2Vzc2VkRGF0ZSxcclxuICAgICAgb3JpZ2luYWxBbW91bnQ6IGlzT3V0Ym91bmQgPyAtdHhuLmRlYWxTdW1PdXRib3VuZCA6IC10eG4uZGVhbFN1bSxcclxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogY29udmVydEN1cnJlbmN5KHR4bi5jdXJyZW50UGF5bWVudEN1cnJlbmN5ID8/IHR4bi5jdXJyZW5jeUlkKSxcclxuICAgICAgY2hhcmdlZEFtb3VudDogaXNPdXRib3VuZCA/IC10eG4ucGF5bWVudFN1bU91dGJvdW5kIDogLXR4bi5wYXltZW50U3VtLFxyXG4gICAgICBjaGFyZ2VkQ3VycmVuY3k6IGNvbnZlcnRDdXJyZW5jeSh0eG4uY3VycmVuY3lJZCksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBpc091dGJvdW5kID8gdHhuLmZ1bGxTdXBwbGllck5hbWVPdXRib3VuZCA6IHR4bi5mdWxsU3VwcGxpZXJOYW1lSGViLFxyXG4gICAgICBtZW1vOiB0eG4ubW9yZUluZm8gfHwgJycsXHJcbiAgICAgIGluc3RhbGxtZW50czogZ2V0SW5zdGFsbG1lbnRzSW5mbyh0eG4pIHx8IHVuZGVmaW5lZCxcclxuICAgICAgc3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcclxuICAgIH07XHJcblxyXG4gICAgaWYgKG9wdGlvbnM/LmluY2x1ZGVSYXdUcmFuc2FjdGlvbikge1xyXG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0eG4pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGZldGNoVHJhbnNhY3Rpb25zKFxyXG4gIHBhZ2U6IFBhZ2UsXHJcbiAgb3B0aW9uczogU2NyYXBlck9wdGlvbnMsXHJcbiAgY29tcGFueVNlcnZpY2VPcHRpb25zOiBDb21wYW55U2VydmljZU9wdGlvbnMsXHJcbiAgc3RhcnRNb21lbnQ6IE1vbWVudCxcclxuICBtb250aE1vbWVudDogTW9tZW50LFxyXG4pOiBQcm9taXNlPFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleD4ge1xyXG4gIGNvbnN0IGFjY291bnRzID0gYXdhaXQgZmV0Y2hBY2NvdW50cyhwYWdlLCBjb21wYW55U2VydmljZU9wdGlvbnMuc2VydmljZXNVcmwsIG1vbnRoTW9tZW50KTtcclxuICBjb25zdCBkYXRhVXJsID0gZ2V0VHJhbnNhY3Rpb25zVXJsKGNvbXBhbnlTZXJ2aWNlT3B0aW9ucy5zZXJ2aWNlc1VybCwgbW9udGhNb21lbnQpO1xyXG4gIGF3YWl0IHNsZWVwKFJBVEVfTElNSVQuU0xFRVBfQkVUV0VFTik7XHJcbiAgZGVidWcoYGZldGNoaW5nIHRyYW5zYWN0aW9ucyBmcm9tICR7ZGF0YVVybH0gZm9yIG1vbnRoICR7bW9udGhNb21lbnQuZm9ybWF0KCdZWVlZLU1NJyl9YCk7XHJcbiAgY29uc3QgZGF0YVJlc3VsdCA9IGF3YWl0IGZldGNoR2V0V2l0aGluUGFnZTxTY3JhcGVkVHJhbnNhY3Rpb25EYXRhPihwYWdlLCBkYXRhVXJsKTtcclxuICBpZiAoZGF0YVJlc3VsdCAmJiBfLmdldChkYXRhUmVzdWx0LCAnSGVhZGVyLlN0YXR1cycpID09PSAnMScgJiYgZGF0YVJlc3VsdC5DYXJkc1RyYW5zYWN0aW9uc0xpc3RCZWFuKSB7XHJcbiAgICBjb25zdCBhY2NvdW50VHhuczogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4ID0ge307XHJcbiAgICBhY2NvdW50cy5mb3JFYWNoKGFjY291bnQgPT4ge1xyXG4gICAgICBjb25zdCB0eG5Hcm91cHM6IFNjcmFwZWRDdXJyZW50Q2FyZFRyYW5zYWN0aW9uc1tdIHwgdW5kZWZpbmVkID0gXy5nZXQoXHJcbiAgICAgICAgZGF0YVJlc3VsdCxcclxuICAgICAgICBgQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbi5JbmRleCR7YWNjb3VudC5pbmRleH0uQ3VycmVudENhcmRUcmFuc2FjdGlvbnNgLFxyXG4gICAgICApO1xyXG4gICAgICBpZiAodHhuR3JvdXBzKSB7XHJcbiAgICAgICAgbGV0IGFsbFR4bnM6IFRyYW5zYWN0aW9uW10gPSBbXTtcclxuICAgICAgICB0eG5Hcm91cHMuZm9yRWFjaCh0eG5Hcm91cCA9PiB7XHJcbiAgICAgICAgICBpZiAodHhuR3JvdXAudHhuSXNyYWVsKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHR4bnMgPSBjb252ZXJ0VHJhbnNhY3Rpb25zKHR4bkdyb3VwLnR4bklzcmFlbCwgYWNjb3VudC5wcm9jZXNzZWREYXRlLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgYWxsVHhucy5wdXNoKC4uLnR4bnMpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKHR4bkdyb3VwLnR4bkFicm9hZCkge1xyXG4gICAgICAgICAgICBjb25zdCB0eG5zID0gY29udmVydFRyYW5zYWN0aW9ucyh0eG5Hcm91cC50eG5BYnJvYWQsIGFjY291bnQucHJvY2Vzc2VkRGF0ZSwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIGFsbFR4bnMucHVzaCguLi50eG5zKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgaWYgKCFvcHRpb25zLmNvbWJpbmVJbnN0YWxsbWVudHMpIHtcclxuICAgICAgICAgIGFsbFR4bnMgPSBmaXhJbnN0YWxsbWVudHMoYWxsVHhucyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChvcHRpb25zLm91dHB1dERhdGE/LmVuYWJsZVRyYW5zYWN0aW9uc0ZpbHRlckJ5RGF0ZSA/PyB0cnVlKSB7XHJcbiAgICAgICAgICBhbGxUeG5zID0gZmlsdGVyT2xkVHJhbnNhY3Rpb25zKGFsbFR4bnMsIHN0YXJ0TW9tZW50LCBvcHRpb25zLmNvbWJpbmVJbnN0YWxsbWVudHMgfHwgZmFsc2UpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhY2NvdW50VHhuc1thY2NvdW50LmFjY291bnROdW1iZXJdID0ge1xyXG4gICAgICAgICAgYWNjb3VudE51bWJlcjogYWNjb3VudC5hY2NvdW50TnVtYmVyLFxyXG4gICAgICAgICAgaW5kZXg6IGFjY291bnQuaW5kZXgsXHJcbiAgICAgICAgICB0eG5zOiBhbGxUeG5zLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIGFjY291bnRUeG5zO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHt9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24oXHJcbiAgcGFnZTogUGFnZSxcclxuICBvcHRpb25zOiBDb21wYW55U2VydmljZU9wdGlvbnMsXHJcbiAgbW9udGg6IE1vbWVudCxcclxuICBhY2NvdW50SW5kZXg6IG51bWJlcixcclxuICB0cmFuc2FjdGlvbjogVHJhbnNhY3Rpb24sXHJcbik6IFByb21pc2U8VHJhbnNhY3Rpb24+IHtcclxuICBjb25zdCB1cmwgPSBuZXcgVVJMKG9wdGlvbnMuc2VydmljZXNVcmwpO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdyZXFOYW1lJywgJ1BpcnRleUlza2FfMjA0Jyk7XHJcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ0NhcmRJbmRleCcsIGFjY291bnRJbmRleC50b1N0cmluZygpKTtcclxuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnc2hvdmFyUmF0eicsIHRyYW5zYWN0aW9uLmlkZW50aWZpZXIhLnRvU3RyaW5nKCkpO1xyXG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdtb2VkQ2hpdXYnLCBtb250aC5mb3JtYXQoJ01NWVlZWScpKTtcclxuXHJcbiAgZGVidWcoYGZldGNoaW5nIGV4dHJhIHNjcmFwIGZvciB0cmFuc2FjdGlvbiAke3RyYW5zYWN0aW9uLmlkZW50aWZpZXJ9IGZvciBtb250aCAke21vbnRoLmZvcm1hdCgnWVlZWS1NTScpfWApO1xyXG4gIGNvbnN0IGRhdGEgPSBhd2FpdCBmZXRjaEdldFdpdGhpblBhZ2U8U2NyYXBlZFRyYW5zYWN0aW9uRGF0YT4ocGFnZSwgdXJsLnRvU3RyaW5nKCkpO1xyXG4gIGlmICghZGF0YSkge1xyXG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcmF3Q2F0ZWdvcnkgPSBfLmdldChkYXRhLCAnUGlydGV5SXNrYV8yMDRCZWFuLnNlY3RvcicpID8/ICcnO1xyXG4gIHJldHVybiB7XHJcbiAgICAuLi50cmFuc2FjdGlvbixcclxuICAgIGNhdGVnb3J5OiByYXdDYXRlZ29yeS50cmltKCksXHJcbiAgICByYXdUcmFuc2FjdGlvbjogZ2V0UmF3VHJhbnNhY3Rpb24oZGF0YSwgdHJhbnNhY3Rpb24pLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldEV4dHJhU2NyYXBBY2NvdW50KFxyXG4gIHBhZ2U6IFBhZ2UsXHJcbiAgb3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxyXG4gIGFjY291bnRNYXA6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleCxcclxuICBtb250aDogbW9tZW50Lk1vbWVudCxcclxuKTogUHJvbWlzZTxTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXg+IHtcclxuICBjb25zdCBhY2NvdW50czogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4W3N0cmluZ11bXSA9IFtdO1xyXG4gIGZvciAoY29uc3QgYWNjb3VudCBvZiBPYmplY3QudmFsdWVzKGFjY291bnRNYXApKSB7XHJcbiAgICBkZWJ1ZyhcclxuICAgICAgYGdldCBleHRyYSBzY3JhcCBmb3IgJHthY2NvdW50LmFjY291bnROdW1iZXJ9IHdpdGggJHthY2NvdW50LnR4bnMubGVuZ3RofSB0cmFuc2FjdGlvbnNgLFxyXG4gICAgICBtb250aC5mb3JtYXQoJ1lZWVktTU0nKSxcclxuICAgICk7XHJcbiAgICBjb25zdCB0eG5zOiBUcmFuc2FjdGlvbltdID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHR4bnNDaHVuayBvZiBfLmNodW5rKGFjY291bnQudHhucywgUkFURV9MSU1JVC5UUkFOU0FDVElPTlNfQkFUQ0hfU0laRSkpIHtcclxuICAgICAgZGVidWcoYHByb2Nlc3NpbmcgY2h1bmsgb2YgJHt0eG5zQ2h1bmsubGVuZ3RofSB0cmFuc2FjdGlvbnMgZm9yIGFjY291bnQgJHthY2NvdW50LmFjY291bnROdW1iZXJ9YCk7XHJcbiAgICAgIGNvbnN0IHVwZGF0ZWRUeG5zID0gYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICAgICAgdHhuc0NodW5rLm1hcCh0ID0+IGdldEV4dHJhU2NyYXBUcmFuc2FjdGlvbihwYWdlLCBvcHRpb25zLCBtb250aCwgYWNjb3VudC5pbmRleCwgdCkpLFxyXG4gICAgICApO1xyXG4gICAgICBhd2FpdCBzbGVlcChSQVRFX0xJTUlULlNMRUVQX0JFVFdFRU4pO1xyXG4gICAgICB0eG5zLnB1c2goLi4udXBkYXRlZFR4bnMpO1xyXG4gICAgfVxyXG4gICAgYWNjb3VudHMucHVzaCh7IC4uLmFjY291bnQsIHR4bnMgfSk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gYWNjb3VudHMucmVkdWNlKChtLCB4KSA9PiAoeyAuLi5tLCBbeC5hY2NvdW50TnVtYmVyXTogeCB9KSwge30pO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRBZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbihcclxuICBzY3JhcGVyT3B0aW9uczogU2NyYXBlck9wdGlvbnMsXHJcbiAgYWNjb3VudHNXaXRoSW5kZXg6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtdLFxyXG4gIHBhZ2U6IFBhZ2UsXHJcbiAgb3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxyXG4gIGFsbE1vbnRoczogbW9tZW50Lk1vbWVudFtdLFxyXG4pOiBQcm9taXNlPFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtdPiB7XHJcbiAgaWYgKFxyXG4gICAgIXNjcmFwZXJPcHRpb25zLmFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uIHx8XHJcbiAgICBzY3JhcGVyT3B0aW9ucy5vcHRJbkZlYXR1cmVzPy5pbmNsdWRlcygnaXNyYWNhcmQtYW1leDpza2lwQWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24nKVxyXG4gICkge1xyXG4gICAgcmV0dXJuIGFjY291bnRzV2l0aEluZGV4O1xyXG4gIH1cclxuICByZXR1cm4gcnVuU2VyaWFsKGFjY291bnRzV2l0aEluZGV4Lm1hcCgoYSwgaSkgPT4gKCkgPT4gZ2V0RXh0cmFTY3JhcEFjY291bnQocGFnZSwgb3B0aW9ucywgYSwgYWxsTW9udGhzW2ldKSkpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFsbFRyYW5zYWN0aW9ucyhcclxuICBwYWdlOiBQYWdlLFxyXG4gIG9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLFxyXG4gIGNvbXBhbnlTZXJ2aWNlT3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxyXG4gIHN0YXJ0TW9tZW50OiBNb21lbnQsXHJcbikge1xyXG4gIGNvbnN0IGZ1dHVyZU1vbnRoc1RvU2NyYXBlID0gb3B0aW9ucy5mdXR1cmVNb250aHNUb1NjcmFwZSA/PyAxO1xyXG4gIGNvbnN0IGFsbE1vbnRocyA9IGdldEFsbE1vbnRoTW9tZW50cyhzdGFydE1vbWVudCwgZnV0dXJlTW9udGhzVG9TY3JhcGUpO1xyXG4gIGNvbnN0IHJlc3VsdHM6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtdID0gYXdhaXQgcnVuU2VyaWFsKFxyXG4gICAgYWxsTW9udGhzLm1hcChtb250aE1vbWVudCA9PiAoKSA9PiB7XHJcbiAgICAgIHJldHVybiBmZXRjaFRyYW5zYWN0aW9ucyhwYWdlLCBvcHRpb25zLCBjb21wYW55U2VydmljZU9wdGlvbnMsIHN0YXJ0TW9tZW50LCBtb250aE1vbWVudCk7XHJcbiAgICB9KSxcclxuICApO1xyXG5cclxuICBjb25zdCBmaW5hbFJlc3VsdCA9IGF3YWl0IGdldEFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uKFxyXG4gICAgb3B0aW9ucyxcclxuICAgIHJlc3VsdHMsXHJcbiAgICBwYWdlLFxyXG4gICAgY29tcGFueVNlcnZpY2VPcHRpb25zLFxyXG4gICAgYWxsTW9udGhzLFxyXG4gICk7XHJcbiAgY29uc3QgY29tYmluZWRUeG5zOiBSZWNvcmQ8c3RyaW5nLCBUcmFuc2FjdGlvbltdPiA9IHt9O1xyXG5cclxuICBmaW5hbFJlc3VsdC5mb3JFYWNoKHJlc3VsdCA9PiB7XHJcbiAgICBPYmplY3Qua2V5cyhyZXN1bHQpLmZvckVhY2goYWNjb3VudE51bWJlciA9PiB7XHJcbiAgICAgIGxldCB0eG5zRm9yQWNjb3VudCA9IGNvbWJpbmVkVHhuc1thY2NvdW50TnVtYmVyXTtcclxuICAgICAgaWYgKCF0eG5zRm9yQWNjb3VudCkge1xyXG4gICAgICAgIHR4bnNGb3JBY2NvdW50ID0gW107XHJcbiAgICAgICAgY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdID0gdHhuc0ZvckFjY291bnQ7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgdG9CZUFkZGVkVHhucyA9IHJlc3VsdFthY2NvdW50TnVtYmVyXS50eG5zO1xyXG4gICAgICBjb21iaW5lZFR4bnNbYWNjb3VudE51bWJlcl0ucHVzaCguLi50b0JlQWRkZWRUeG5zKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBjb25zdCBhY2NvdW50cyA9IE9iamVjdC5rZXlzKGNvbWJpbmVkVHhucykubWFwKGFjY291bnROdW1iZXIgPT4ge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgYWNjb3VudE51bWJlcixcclxuICAgICAgdHhuczogY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdLFxyXG4gICAgfTtcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICBhY2NvdW50cyxcclxuICB9O1xyXG59XHJcblxyXG50eXBlIFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzID0geyBpZDogc3RyaW5nOyBwYXNzd29yZDogc3RyaW5nOyBjYXJkNkRpZ2l0czogc3RyaW5nIH07XHJcbmNsYXNzIElzcmFjYXJkQW1leEJhc2VTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xyXG4gIHByaXZhdGUgYmFzZVVybDogc3RyaW5nO1xyXG5cclxuICBwcml2YXRlIGNvbXBhbnlDb2RlOiBzdHJpbmc7XHJcblxyXG4gIHByaXZhdGUgc2VydmljZXNVcmw6IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3Iob3B0aW9uczogU2NyYXBlck9wdGlvbnMsIGJhc2VVcmw6IHN0cmluZywgY29tcGFueUNvZGU6IHN0cmluZykge1xyXG4gICAgc3VwZXIob3B0aW9ucyk7XHJcblxyXG4gICAgdGhpcy5iYXNlVXJsID0gYmFzZVVybDtcclxuICAgIHRoaXMuY29tcGFueUNvZGUgPSBjb21wYW55Q29kZTtcclxuICAgIHRoaXMuc2VydmljZXNVcmwgPSBgJHtiYXNlVXJsfS9zZXJ2aWNlcy9Qcm94eVJlcXVlc3RIYW5kbGVyLmFzaHhgO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbG9naW4oY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKTogUHJvbWlzZTxTY3JhcGVyU2NyYXBpbmdSZXN1bHQ+IHtcclxuICAgIC8vIEFudGktZGV0ZWN0aW9uOiByZWFsaXN0aWMgVUEsIGNsaWVudCBoaW50cywgc3RlYWx0aCBKUyDigJQgbXVzdCBydW4gQkVGT1JFIG5hdmlnYXRpb25cclxuICAgIGF3YWl0IGFwcGx5QW50aURldGVjdGlvbih0aGlzLnBhZ2UpO1xyXG5cclxuICAgIGF3YWl0IHRoaXMucGFnZS5zZXRSZXF1ZXN0SW50ZXJjZXB0aW9uKHRydWUpO1xyXG4gICAgdGhpcy5wYWdlLm9uKCdyZXF1ZXN0JywgcmVxdWVzdCA9PiB7XHJcbiAgICAgIGlmIChpc0JvdERldGVjdGlvblNjcmlwdChyZXF1ZXN0LnVybCgpKSkge1xyXG4gICAgICAgIGRlYnVnKGBibG9ja2luZyBib3QgZGV0ZWN0aW9uIHNjcmlwdDogJHtyZXF1ZXN0LnVybCgpfWApO1xyXG4gICAgICAgIHZvaWQgcmVxdWVzdC5hYm9ydCh1bmRlZmluZWQsIGludGVyY2VwdGlvblByaW9yaXRpZXMuYWJvcnQpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHZvaWQgcmVxdWVzdC5jb250aW51ZSh1bmRlZmluZWQsIGludGVyY2VwdGlvblByaW9yaXRpZXMuY29udGludWUpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBkZWJ1ZyhgbmF2aWdhdGluZyB0byAke3RoaXMuYmFzZVVybH0vcGVyc29uYWxhcmVhL0xvZ2luYCk7XHJcbiAgICBhd2FpdCB0aGlzLm5hdmlnYXRlVG8oYCR7dGhpcy5iYXNlVXJsfS9wZXJzb25hbGFyZWEvTG9naW5gKTtcclxuICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkxvZ2dpbmdJbik7XHJcblxyXG4gICAgY29uc3QgdmFsaWRhdGVSZXN1bHQgPSBhd2FpdCB0aGlzLnZhbGlkYXRlQ3JlZGVudGlhbHMoY3JlZGVudGlhbHMpO1xyXG4gICAgaWYgKCF2YWxpZGF0ZVJlc3VsdCkge1xyXG4gICAgICBjb25zdCBwYWdlVXJsID0gdGhpcy5wYWdlLnVybCgpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGxvZ2luIHZhbGlkYXRpb24gZmFpbGVkIChwYWdlVXJsPSR7cGFnZVVybH0pLiBQb3NzaWJsZSBXQUYgYmxvY2suYCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdmFsaWRhdGVkRGF0YSA9IHZhbGlkYXRlUmVzdWx0LlZhbGlkYXRlSWREYXRhQmVhbiE7XHJcbiAgICBjb25zdCB2YWxpZGF0ZVJldHVybkNvZGUgPSB2YWxpZGF0ZWREYXRhLnJldHVybkNvZGU7XHJcbiAgICBkZWJ1ZyhgdXNlciB2YWxpZGF0ZSB3aXRoIHJldHVybiBjb2RlICcke3ZhbGlkYXRlUmV0dXJuQ29kZX0nYCk7XHJcbiAgICBpZiAodmFsaWRhdGVSZXR1cm5Db2RlID09PSAnMScpIHtcclxuICAgICAgY29uc3QgeyB1c2VyTmFtZSB9ID0gdmFsaWRhdGVkRGF0YTtcclxuXHJcbiAgICAgIGNvbnN0IGxvZ2luVXJsID0gYCR7dGhpcy5zZXJ2aWNlc1VybH0/cmVxTmFtZT1wZXJmb3JtTG9nb25JYDtcclxuICAgICAgY29uc3QgcmVxdWVzdCA9IHtcclxuICAgICAgICBLb2RNaXNodGFtZXNoOiB1c2VyTmFtZSxcclxuICAgICAgICBNaXNwYXJaaWh1eTogY3JlZGVudGlhbHMuaWQsXHJcbiAgICAgICAgU2lzbWE6IGNyZWRlbnRpYWxzLnBhc3N3b3JkLFxyXG4gICAgICAgIGNhcmRTdWZmaXg6IGNyZWRlbnRpYWxzLmNhcmQ2RGlnaXRzLFxyXG4gICAgICAgIGNvdW50cnlDb2RlOiBDT1VOVFJZX0NPREUsXHJcbiAgICAgICAgaWRUeXBlOiBJRF9UWVBFLFxyXG4gICAgICB9O1xyXG4gICAgICBkZWJ1ZygndXNlciBsb2dpbiBzdGFydGVkJyk7XHJcbiAgICAgIGNvbnN0IGxvZ2luUmVzdWx0ID0gYXdhaXQgZmV0Y2hQb3N0V2l0aGluUGFnZTx7IHN0YXR1czogc3RyaW5nIH0+KHRoaXMucGFnZSwgbG9naW5VcmwsIHJlcXVlc3QpO1xyXG4gICAgICBkZWJ1ZyhgdXNlciBsb2dpbiB3aXRoIHN0YXR1cyAnJHtsb2dpblJlc3VsdD8uc3RhdHVzfSdgLCBsb2dpblJlc3VsdCk7XHJcblxyXG4gICAgICBpZiAobG9naW5SZXN1bHQgJiYgbG9naW5SZXN1bHQuc3RhdHVzID09PSAnMScpIHtcclxuICAgICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dpblN1Y2Nlc3MpO1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGxvZ2luUmVzdWx0ICYmIGxvZ2luUmVzdWx0LnN0YXR1cyA9PT0gJzMnKSB7XHJcbiAgICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NyYXBlclByb2dyZXNzVHlwZXMuQ2hhbmdlUGFzc3dvcmQpO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgIGVycm9yVHlwZTogU2NyYXBlckVycm9yVHlwZXMuQ2hhbmdlUGFzc3dvcmQsXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NyYXBlclByb2dyZXNzVHlwZXMuTG9naW5GYWlsZWQpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yVHlwZTogU2NyYXBlckVycm9yVHlwZXMuSW52YWxpZFBhc3N3b3JkLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh2YWxpZGF0ZVJldHVybkNvZGUgPT09ICc0Jykge1xyXG4gICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5DaGFuZ2VQYXNzd29yZCk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3JUeXBlOiBTY3JhcGVyRXJyb3JUeXBlcy5DaGFuZ2VQYXNzd29yZCxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dpbkZhaWxlZCk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgZXJyb3JUeXBlOiBTY3JhcGVyRXJyb3JUeXBlcy5JbnZhbGlkUGFzc3dvcmQsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZUNyZWRlbnRpYWxzKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyk6IFByb21pc2U8U2NyYXBlZExvZ2luVmFsaWRhdGlvbiB8IG51bGw+IHtcclxuICAgIGNvbnN0IHZhbGlkYXRlVXJsID0gYCR7dGhpcy5zZXJ2aWNlc1VybH0/cmVxTmFtZT1WYWxpZGF0ZUlkRGF0YWA7XHJcbiAgICBjb25zdCB2YWxpZGF0ZVJlcXVlc3QgPSB7XHJcbiAgICAgIGlkOiBjcmVkZW50aWFscy5pZCxcclxuICAgICAgY2FyZFN1ZmZpeDogY3JlZGVudGlhbHMuY2FyZDZEaWdpdHMsXHJcbiAgICAgIGNvdW50cnlDb2RlOiBDT1VOVFJZX0NPREUsXHJcbiAgICAgIGlkVHlwZTogSURfVFlQRSxcclxuICAgICAgY2hlY2tMZXZlbDogJzEnLFxyXG4gICAgICBjb21wYW55Q29kZTogdGhpcy5jb21wYW55Q29kZSxcclxuICAgIH07XHJcbiAgICBkZWJ1ZygndmFsaWRhdGluZyBjcmVkZW50aWFscycpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmV0Y2hQb3N0V2l0aGluUGFnZTxTY3JhcGVkTG9naW5WYWxpZGF0aW9uPih0aGlzLnBhZ2UsIHZhbGlkYXRlVXJsLCB2YWxpZGF0ZVJlcXVlc3QpO1xyXG4gICAgaWYgKCFyZXN1bHQ/LkhlYWRlciB8fCByZXN1bHQuSGVhZGVyLlN0YXR1cyAhPT0gJzEnIHx8ICFyZXN1bHQuVmFsaWRhdGVJZERhdGFCZWFuKSByZXR1cm4gbnVsbDtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBhc3luYyBmZXRjaERhdGEoKSB7XHJcbiAgICBjb25zdCBkZWZhdWx0U3RhcnRNb21lbnQgPSBtb21lbnQoKS5zdWJ0cmFjdCgxLCAneWVhcnMnKTtcclxuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xyXG4gICAgY29uc3Qgc3RhcnRNb21lbnQgPSBtb21lbnQubWF4KGRlZmF1bHRTdGFydE1vbWVudCwgbW9tZW50KHN0YXJ0RGF0ZSkpO1xyXG5cclxuICAgIHJldHVybiBmZXRjaEFsbFRyYW5zYWN0aW9ucyhcclxuICAgICAgdGhpcy5wYWdlLFxyXG4gICAgICB0aGlzLm9wdGlvbnMsXHJcbiAgICAgIHtcclxuICAgICAgICBzZXJ2aWNlc1VybDogdGhpcy5zZXJ2aWNlc1VybCxcclxuICAgICAgICBjb21wYW55Q29kZTogdGhpcy5jb21wYW55Q29kZSxcclxuICAgICAgfSxcclxuICAgICAgc3RhcnRNb21lbnQsXHJcbiAgICApO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXI7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsSUFBQUEsT0FBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUMsT0FBQSxHQUFBRixzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUUsVUFBQSxHQUFBRixPQUFBO0FBQ0EsSUFBQUcsWUFBQSxHQUFBSCxPQUFBO0FBQ0EsSUFBQUksTUFBQSxHQUFBTCxzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUssTUFBQSxHQUFBTCxPQUFBO0FBQ0EsSUFBQU0sTUFBQSxHQUFBTixPQUFBO0FBQ0EsSUFBQU8sYUFBQSxHQUFBUCxPQUFBO0FBQ0EsSUFBQVEsUUFBQSxHQUFBUixPQUFBO0FBQ0EsSUFBQVMsY0FBQSxHQUFBVCxPQUFBO0FBT0EsSUFBQVUsdUJBQUEsR0FBQVYsT0FBQTtBQUNBLElBQUFXLE9BQUEsR0FBQVgsT0FBQTtBQUVBLElBQUFZLFFBQUEsR0FBQVosT0FBQTtBQUFzRyxTQUFBRCx1QkFBQWMsQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQUV0RyxNQUFNRyxVQUFVLEdB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