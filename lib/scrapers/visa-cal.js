"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _debug = require("../helpers/debug");
var _elementsInteractions = require("../helpers/elements-interactions");
var _fetch = require("../helpers/fetch");
var _navigation = require("../helpers/navigation");
var _storage = require("../helpers/storage");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
var _lodash = _interopRequireDefault(require("lodash"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const apiHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty'
};
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const FRAMES_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const debug = (0, _debug.getDebug)('visa-cal');
var TrnTypeCode = /*#__PURE__*/function (TrnTypeCode) {
  TrnTypeCode["regular"] = "5";
  TrnTypeCode["credit"] = "6";
  TrnTypeCode["installments"] = "8";
  TrnTypeCode["standingOrder"] = "9";
  return TrnTypeCode;
}(TrnTypeCode || {});
function isAuthModule(result) {
  return Boolean(result?.auth?.calConnectToken && String(result.auth.calConnectToken).trim());
}
function authModuleOrUndefined(result) {
  return isAuthModule(result) ? result : undefined;
}
function isPending(transaction) {
  return transaction.debCrdDate === undefined; // an arbitrary field that only appears in a completed transaction
}
function isCardTransactionDetails(result) {
  return result.result !== undefined;
}
function isCardPendingTransactionDetails(result) {
  return result.result !== undefined;
}
async function getLoginFrame(page) {
  let frame = null;
  debug('wait until login frame found');
  await (0, _waiting.waitUntil)(() => {
    frame = page.frames().find(f => f.url().includes('connect')) || null;
    return Promise.resolve(!!frame);
  }, 'wait for iframe with login form', 10000, 1000);
  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }
  return frame;
}
async function hasInvalidPasswordError(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, 'div.general-error > div');
  const errorMessage = errorFound ? await (0, _elementsInteractions.pageEval)(frame, 'div.general-error > div', '', item => {
    return item.innerText;
  }) : '';
  return errorMessage === InvalidPasswordMessage;
}
async function hasChangePasswordForm(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, '.change-password-subtitle');
  return errorFound;
}
function getPossibleLoginResults() {
  debug('return possible login results');
  const urls = {
    [_baseScraperWithBrowser.LoginResults.Success]: [/dashboard/i],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasInvalidPasswordError(page);
    }],
    // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    [_baseScraperWithBrowser.LoginResults.ChangePassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasChangePasswordForm(page);
    }]
  };
  return urls;
}
function createLoginFields(credentials) {
  debug('create login fields for username and password');
  return [{
    selector: '[formcontrolname="userName"]',
    value: credentials.username
  }, {
    selector: '[formcontrolname="password"]',
    value: credentials.password
  }];
}
function convertParsedDataToTransactions(data, pendingData, options) {
  const pendingTransactions = pendingData?.result ? pendingData.result.cardsList.flatMap(card => card.authDetalisList) : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const regularDebitDays = bankAccounts.flatMap(accounts => accounts.debitDates);
  const immediateDebitDays = bankAccounts.flatMap(accounts => accounts.immidiateDebits.debitDays);
  const completedTransactions = [...regularDebitDays, ...immediateDebitDays].flatMap(debitDate => debitDate.transactions);
  const all = [...pendingTransactions, ...completedTransactions];
  return all.map(transaction => {
    const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
    const installments = numOfPayments ? {
      number: isPending(transaction) ? 1 : transaction.curPaymentNum,
      total: numOfPayments
    } : undefined;
    const date = (0, _moment.default)(transaction.trnPurchaseDate);
    const chargedAmount = (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1;
    const originalAmount = transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.credit ? 1 : -1);
    const result = {
      identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
      type: [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode) ? _transactions2.TransactionTypes.Normal : _transactions2.TransactionTypes.Installments,
      status: isPending(transaction) ? _transactions2.TransactionStatuses.Pending : _transactions2.TransactionStatuses.Completed,
      date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
      processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
      originalAmount,
      originalCurrency: transaction.trnCurrencySymbol,
      chargedAmount,
      chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
      description: transaction.merchantName,
      memo: transaction.transTypeCommentDetails.toString(),
      category: transaction.branchCodeDesc
    };
    if (installments) {
      result.installments = installments;
    }
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(transaction);
    }
    return result;
  });
}
class VisaCalScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  authorization = undefined;
  openLoginPopup = async () => {
    debug('open login popup, wait until login button available');
    await (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn', true);
    debug('click on the login button');
    await (0, _elementsInteractions.clickButton)(this.page, '#ccLoginDesktopBtn');
    debug('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    debug('wait until the password login tab header is available');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, '#regular-login');
    debug('navigate to the password login tab');
    await (0, _elementsInteractions.clickButton)(frame, '#regular-login');
    debug('wait until the password login tab is active');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, 'regular-login');
    return frame;
  };
  async getCards() {
    const initData = await (0, _waiting.waitUntil)(() => (0, _storage.getFromSessionStorage)(this.page, 'init'), 'get init data in session storage', 10000, 1000);
    if (!initData) {
      throw new Error('could not find "init" data in session storage');
    }
    return initData?.result.cards.map(({
      cardUniqueId,
      last4Digits
    }) => ({
      cardUniqueId,
      last4Digits
    }));
  }
  async getAuthorizationHeader() {
    if (!this.authorization) {
      debug('fetching authorization header');
      const authModule = await (0, _waiting.waitUntil)(async () => authModuleOrUndefined(await (0, _storage.getFromSessionStorage)(this.page, 'auth-module')), 'get authorization header with valid token in session storage', 10_000, 50);
      return `CALAuthScheme ${authModule.auth.calConnectToken}`;
    }
    return this.authorization;
  }
  async getXSiteId() {
    /*
      I don't know if the constant below will change in the feature.
      If so, use the next code:
        return this.page.evaluate(() => new Ut().xSiteId);
        To get the classname search for 'xSiteId' in the page source
      class Ut {
        constructor(_e, on, yn) {
            this.store = _e,
            this.config = on,
            this.eventBusService = yn,
            this.xSiteId = "09031987-273E-2311-906C-8AF85B17C8D9",
    */
    return Promise.resolve('09031987-273E-2311-906C-8AF85B17C8D9');
  }
  getLoginOptions(credentials) {
    this.authRequestPromise = this.page.waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, {
      timeout: 10_000
    }).catch(e => {
      debug('error while waiting for the token request', e);
      return undefined;
    });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: async () => {
        try {
          await (0, _navigation.waitForNavigation)(this.page);
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('site-tutorial')) {
            await (0, _elementsInteractions.clickButton)(this.page, 'button.btn-close');
          }
          const request = await this.authRequestPromise;
          this.authorization = String(request?.headers().authorization || '').trim();
        } catch (e) {
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('dashboard')) return;
          const requiresChangePassword = await hasChangePasswordForm(this.page);
          if (requiresChangePassword) return;
          throw e;
        }
      },
      userAgent: apiHeaders['User-Agent']
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    debug(`fetch transactions starting ${startMoment.format()}`);
    const [cards, xSiteId, Authorization] = await Promise.all([this.getCards(), this.getXSiteId(), this.getAuthorizationHeader()]);
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    debug('fetch frames (misgarot) of cards');
    const frames = await (0, _fetch.fetchPost)(FRAMES_REQUEST_ENDPOINT, {
      cardsForFrameData: cards.map(({
        cardUniqueId
      }) => ({
        cardUniqueId
      }))
    }, {
      Authorization,
      'X-Site-Id': xSiteId,
      'Content-Type': 'application/json',
      ...apiHeaders
    });
    const accounts = await Promise.all(cards.map(async card => {
      const finalMonthToFetchMoment = (0, _moment.default)().add(futureMonthsToScrape, 'month');
      const months = finalMonthToFetchMoment.diff(startMoment, 'months');
      const allMonthsData = [];
      const frame = _lodash.default.find(frames.result?.bankIssuedCards?.cardLevelFrames, {
        cardUniqueId: card.cardUniqueId
      });
      debug(`fetch pending transactions for card ${card.cardUniqueId}`);
      let pendingData = await (0, _fetch.fetchPost)(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, {
        cardUniqueIDArray: [card.cardUniqueId]
      }, {
        Authorization,
        'X-Site-Id': xSiteId,
        'Content-Type': 'application/json',
        ...apiHeaders
      });
      debug(`fetch completed transactions for card ${card.cardUniqueId}`);
      for (let i = 0; i <= months; i++) {
        const month = finalMonthToFetchMoment.clone().subtract(i, 'months');
        const monthData = await (0, _fetch.fetchPost)(TRANSACTIONS_REQUEST_ENDPOINT, {
          cardUniqueId: card.cardUniqueId,
          month: month.format('M'),
          year: month.format('YYYY')
        }, {
          Authorization,
          'X-Site-Id': xSiteId,
          'Content-Type': 'application/json',
          ...apiHeaders
        });
        if (monthData?.statusCode !== 1) throw new Error(`failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`);
        if (!isCardTransactionDetails(monthData)) {
          throw new Error('monthData is not of type CardTransactionDetails');
        }
        allMonthsData.push(monthData);
      }
      if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
        debug(`failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`);
        pendingData = null;
      } else if (!isCardPendingTransactionDetails(pendingData)) {
        debug('pendingData is not of type CardTransactionDetails');
        pendingData = null;
      }
      const transactions = convertParsedDataToTransactions(allMonthsData, pendingData, this.options);
      debug('filter out old transactions');
      const txns = this.options.outputData?.enableTransactionsFilterByDate ?? true ? (0, _transactions.filterOldTransactions)(transactions, (0, _moment.default)(startDate), this.options.combineInstallments || false) : transactions;
      return {
        txns,
        balance: frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined,
        accountNumber: card.last4Digits
      };
    }));
    debug('return the scraped accounts');
    debug(JSON.stringify(accounts, null, 2));
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = VisaCalScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfZGVidWciLCJfZWxlbWVudHNJbnRlcmFjdGlvbnMiLCJfZmV0Y2giLCJfbmF2aWdhdGlvbiIsIl9zdG9yYWdlIiwiX3RyYW5zYWN0aW9ucyIsIl93YWl0aW5nIiwiX3RyYW5zYWN0aW9uczIiLCJfYmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsIl9sb2Rhc2giLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJhcGlIZWFkZXJzIiwiT3JpZ2luIiwiUmVmZXJlciIsIkxPR0lOX1VSTCIsIlRSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5UIiwiRlJBTUVTX1JFUVVFU1RfRU5EUE9JTlQiLCJQRU5ESU5HX1RSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5UIiwiU1NPX0FVVEhPUklaQVRJT05fUkVRVUVTVF9FTkRQT0lOVCIsIkludmFsaWRQYXNzd29yZE1lc3NhZ2UiLCJkZWJ1ZyIsImdldERlYnVnIiwiVHJuVHlwZUNvZGUiLCJpc0F1dGhNb2R1bGUiLCJyZXN1bHQiLCJCb29sZWFuIiwiYXV0aCIsImNhbENvbm5lY3RUb2tlbiIsIlN0cmluZyIsInRyaW0iLCJhdXRoTW9kdWxlT3JVbmRlZmluZWQiLCJ1bmRlZmluZWQiLCJpc1BlbmRpbmciLCJ0cmFuc2FjdGlvbiIsImRlYkNyZERhdGUiLCJpc0NhcmRUcmFuc2FjdGlvbkRldGFpbHMiLCJpc0NhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIiwiZ2V0TG9naW5GcmFtZSIsInBhZ2UiLCJmcmFtZSIsIndhaXRVbnRpbCIsImZyYW1lcyIsImZpbmQiLCJmIiwidXJsIiwiaW5jbHVkZXMiLCJQcm9taXNlIiwicmVzb2x2ZSIsIkVycm9yIiwiaGFzSW52YWxpZFBhc3N3b3JkRXJyb3IiLCJlcnJvckZvdW5kIiwiZWxlbWVudFByZXNlbnRPblBhZ2UiLCJlcnJvck1lc3NhZ2UiLCJwYWdlRXZhbCIsIml0ZW0iLCJpbm5lclRleHQiLCJoYXNDaGFuZ2VQYXNzd29yZEZvcm0iLCJnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cyIsInVybHMiLCJMb2dpblJlc3VsdHMiLCJTdWNjZXNzIiwiSW52YWxpZFBhc3N3b3JkIiwib3B0aW9ucyIsIkNoYW5nZVBhc3N3b3JkIiwiY3JlYXRlTG9naW5GaWVsZHMiLCJjcmVkZW50aWFscyIsInNlbGVjdG9yIiwidmFsdWUiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwiY29udmVydFBhcnNlZERhdGFUb1RyYW5zYWN0aW9ucyIsImRhdGEiLCJwZW5kaW5nRGF0YSIsInBlbmRpbmdUcmFuc2FjdGlvbnMiLCJjYXJkc0xpc3QiLCJmbGF0TWFwIiwiY2FyZCIsImF1dGhEZXRhbGlzTGlzdCIsImJhbmtBY2NvdW50cyIsIm1vbnRoRGF0YSIsInJlZ3VsYXJEZWJpdERheXMiLCJhY2NvdW50cyIsImRlYml0RGF0ZXMiLCJpbW1lZGlhdGVEZWJpdERheXMiLCJpbW1pZGlhdGVEZWJpdHMiLCJkZWJpdERheXMiLCJjb21wbGV0ZWRUcmFuc2FjdGlvbnMiLCJkZWJpdERhdGUiLCJ0cmFuc2FjdGlvbnMiLCJhbGwiLCJtYXAiLCJudW1PZlBheW1lbnRzIiwibnVtYmVyT2ZQYXltZW50cyIsImluc3RhbGxtZW50cyIsIm51bWJlciIsImN1clBheW1lbnROdW0iLCJ0b3RhbCIsImRhdGUiLCJtb21lbnQiLCJ0cm5QdXJjaGFzZURhdGUiLCJjaGFyZ2VkQW1vdW50IiwidHJuQW10IiwiYW10QmVmb3JlQ29udkFuZEluZGV4Iiwib3JpZ2luYWxBbW91bnQiLCJ0cm5UeXBlQ29kZSIsImNyZWRpdCIsImlkZW50aWZpZXIiLCJ0cm5JbnRJZCIsInR5cGUiLCJyZWd1bGFyIiwic3RhbmRpbmdPcmRlciIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJJbnN0YWxsbWVudHMiLCJzdGF0dXMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiUGVuZGluZyIsIkNvbXBsZXRlZCIsImFkZCIsInRvSVNPU3RyaW5nIiwicHJvY2Vzc2VkRGF0ZSIsIkRhdGUiLCJvcmlnaW5hbEN1cnJlbmN5IiwidHJuQ3VycmVuY3lTeW1ib2wiLCJjaGFyZ2VkQ3VycmVuY3kiLCJkZWJDcmRDdXJyZW5jeVN5bWJvbCIsImRlc2NyaXB0aW9uIiwibWVyY2hhbnROYW1lIiwibWVtbyIsInRyYW5zVHlwZUNvbW1lbnREZXRhaWxzIiwidG9TdHJpbmciLCJjYXRlZ29yeSIsImJyYW5jaENvZGVEZXNjIiwiaW5jbHVkZVJhd1RyYW5zYWN0aW9uIiwicmF3VHJhbnNhY3Rpb24iLCJnZXRSYXdUcmFuc2FjdGlvbiIsIlZpc2FDYWxTY3JhcGVyIiwiQmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImF1dGhvcml6YXRpb24iLCJvcGVuTG9naW5Qb3B1cCIsIndhaXRVbnRpbEVsZW1lbnRGb3VuZCIsImNsaWNrQnV0dG9uIiwiZ2V0Q2FyZHMiLCJpbml0RGF0YSIsImdldEZyb21TZXNzaW9uU3RvcmFnZSIsImNhcmRzIiwiY2FyZFVuaXF1ZUlkIiwibGFzdDREaWdpdHMiLCJnZXRBdXRob3JpemF0aW9uSGVhZGVyIiwiYXV0aE1vZHVsZSIsImdldFhTaXRlSWQiLCJnZXRMb2dpbk9wdGlvbnMiLCJhdXRoUmVxdWVzdFByb21pc2UiLCJ3YWl0Rm9yUmVxdWVzdCIsInRpbWVvdXQiLCJjYXRjaCIsImxvZ2luVXJsIiwiZmllbGRzIiwic3VibWl0QnV0dG9uU2VsZWN0b3IiLCJwb3NzaWJsZVJlc3VsdHMiLCJjaGVja1JlYWRpbmVzcyIsInByZUFjdGlvbiIsInBvc3RBY3Rpb24iLCJ3YWl0Rm9yTmF2aWdhdGlvbiIsImN1cnJlbnRVcmwiLCJnZXRDdXJyZW50VXJsIiwiZW5kc1dpdGgiLCJyZXF1ZXN0IiwiaGVhZGVycyIsInJlcXVpcmVzQ2hhbmdlUGFzc3dvcmQiLCJ1c2VyQWdlbnQiLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsInN0YXJ0RGF0ZSIsInRvRGF0ZSIsInN0YXJ0TW9tZW50IiwibWF4IiwiZm9ybWF0IiwieFNpdGVJZCIsIkF1dGhvcml6YXRpb24iLCJmdXR1cmVNb250aHNUb1NjcmFwZSIsImZldGNoUG9zdCIsImNhcmRzRm9yRnJhbWVEYXRhIiwiZmluYWxNb250aFRvRmV0Y2hNb21lbnQiLCJtb250aHMiLCJkaWZmIiwiYWxsTW9udGhzRGF0YSIsIl8iLCJiYW5rSXNzdWVkQ2FyZHMiLCJjYXJkTGV2ZWxGcmFtZXMiLCJjYXJkVW5pcXVlSURBcnJheSIsImkiLCJtb250aCIsImNsb25lIiwieWVhciIsInN0YXR1c0NvZGUiLCJ0aXRsZSIsInB1c2giLCJ0eG5zIiwib3V0cHV0RGF0YSIsImVuYWJsZVRyYW5zYWN0aW9uc0ZpbHRlckJ5RGF0ZSIsImZpbHRlck9sZFRyYW5zYWN0aW9ucyIsImNvbWJpbmVJbnN0YWxsbWVudHMiLCJiYWxhbmNlIiwibmV4dFRvdGFsRGViaXQiLCJhY2NvdW50TnVtYmVyIiwiSlNPTiIsInN0cmluZ2lmeSIsInN1Y2Nlc3MiLCJfZGVmYXVsdCIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi9zcmMvc2NyYXBlcnMvdmlzYS1jYWwudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IG1vbWVudCBmcm9tICdtb21lbnQnO1xyXG5pbXBvcnQgeyB0eXBlIEhUVFBSZXF1ZXN0LCB0eXBlIEZyYW1lLCB0eXBlIFBhZ2UgfSBmcm9tICdwdXBwZXRlZXInO1xyXG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xyXG5pbXBvcnQgeyBjbGlja0J1dHRvbiwgZWxlbWVudFByZXNlbnRPblBhZ2UsIHBhZ2VFdmFsLCB3YWl0VW50aWxFbGVtZW50Rm91bmQgfSBmcm9tICcuLi9oZWxwZXJzL2VsZW1lbnRzLWludGVyYWN0aW9ucyc7XHJcbmltcG9ydCB7IGZldGNoUG9zdCB9IGZyb20gJy4uL2hlbHBlcnMvZmV0Y2gnO1xyXG5pbXBvcnQgeyBnZXRDdXJyZW50VXJsLCB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XHJcbmltcG9ydCB7IGdldEZyb21TZXNzaW9uU3RvcmFnZSB9IGZyb20gJy4uL2hlbHBlcnMvc3RvcmFnZSc7XHJcbmltcG9ydCB7IGZpbHRlck9sZFRyYW5zYWN0aW9ucywgZ2V0UmF3VHJhbnNhY3Rpb24gfSBmcm9tICcuLi9oZWxwZXJzL3RyYW5zYWN0aW9ucyc7XHJcbmltcG9ydCB7IHdhaXRVbnRpbCB9IGZyb20gJy4uL2hlbHBlcnMvd2FpdGluZyc7XHJcbmltcG9ydCB7IFRyYW5zYWN0aW9uU3RhdHVzZXMsIFRyYW5zYWN0aW9uVHlwZXMsIHR5cGUgVHJhbnNhY3Rpb24sIHR5cGUgVHJhbnNhY3Rpb25zQWNjb3VudCB9IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XHJcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIsIExvZ2luUmVzdWx0cywgdHlwZSBMb2dpbk9wdGlvbnMgfSBmcm9tICcuL2Jhc2Utc2NyYXBlci13aXRoLWJyb3dzZXInO1xyXG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCwgdHlwZSBTY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vaW50ZXJmYWNlJztcclxuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcclxuXHJcbmNvbnN0IGFwaUhlYWRlcnMgPSB7XHJcbiAgJ1VzZXItQWdlbnQnOlxyXG4gICAgJ01vemlsbGEvNS4wIChNYWNpbnRvc2g7IEludGVsIE1hYyBPUyBYIDEwXzE1XzcpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDIuMC4wLjAgU2FmYXJpLzUzNy4zNicsXHJcbiAgT3JpZ2luOiAnaHR0cHM6Ly9kaWdpdGFsLXdlYi5jYWwtb25saW5lLmNvLmlsJyxcclxuICBSZWZlcmVyOiAnaHR0cHM6Ly9kaWdpdGFsLXdlYi5jYWwtb25saW5lLmNvLmlsJyxcclxuICAnQWNjZXB0LUxhbmd1YWdlJzogJ2hlLUlMLGhlO3E9MC45LGVuLVVTO3E9MC44LGVuO3E9MC43JyxcclxuICAnU2VjLUZldGNoLVNpdGUnOiAnc2FtZS1zaXRlJyxcclxuICAnU2VjLUZldGNoLU1vZGUnOiAnY29ycycsXHJcbiAgJ1NlYy1GZXRjaC1EZXN0JzogJ2VtcHR5JyxcclxufTtcclxuY29uc3QgTE9HSU5fVVJMID0gJ2h0dHBzOi8vd3d3LmNhbC1vbmxpbmUuY28uaWwvJztcclxuY29uc3QgVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQgPVxyXG4gICdodHRwczovL2FwaS5jYWwtb25saW5lLmNvLmlsL1RyYW5zYWN0aW9ucy9hcGkvdHJhbnNhY3Rpb25zRGV0YWlscy9nZXRDYXJkVHJhbnNhY3Rpb25zRGV0YWlscyc7XHJcbmNvbnN0IEZSQU1FU19SRVFVRVNUX0VORFBPSU5UID0gJ2h0dHBzOi8vYXBpLmNhbC1vbmxpbmUuY28uaWwvRnJhbWVzL2FwaS9GcmFtZXMvR2V0RnJhbWVTdGF0dXMnO1xyXG5jb25zdCBQRU5ESU5HX1RSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5UID1cclxuICAnaHR0cHM6Ly9hcGkuY2FsLW9ubGluZS5jby5pbC9UcmFuc2FjdGlvbnMvYXBpL2FwcHJvdmFscy9nZXRDbGVhcmFuY2VSZXF1ZXN0cyc7XHJcbmNvbnN0IFNTT19BVVRIT1JJWkFUSU9OX1JFUVVFU1RfRU5EUE9JTlQgPSAnaHR0cHM6Ly9jb25uZWN0LmNhbC1vbmxpbmUuY28uaWwvY29sLXJlc3QvY2FsY29ubmVjdC9hdXRoZW50aWNhdGlvbi9TU08nO1xyXG5cclxuY29uc3QgSW52YWxpZFBhc3N3b3JkTWVzc2FnZSA9ICfXqdedINeU157Xqdeq157XqSDXkNeVINeU16HXmdeh157XlCDXqdeU15XXlteg15Ug16nXkteV15nXmdedJztcclxuXHJcbmNvbnN0IGRlYnVnID0gZ2V0RGVidWcoJ3Zpc2EtY2FsJyk7XHJcblxyXG5lbnVtIFRyblR5cGVDb2RlIHtcclxuICByZWd1bGFyID0gJzUnLFxyXG4gIGNyZWRpdCA9ICc2JyxcclxuICBpbnN0YWxsbWVudHMgPSAnOCcsXHJcbiAgc3RhbmRpbmdPcmRlciA9ICc5JyxcclxufVxyXG5cclxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbiB7XHJcbiAgYW10QmVmb3JlQ29udkFuZEluZGV4OiBudW1iZXI7XHJcbiAgYnJhbmNoQ29kZURlc2M6IHN0cmluZztcclxuICBjYXNoQWNjTWFuYWdlck5hbWU6IG51bGw7XHJcbiAgY2FzaEFjY291bnRNYW5hZ2VyOiBudWxsO1xyXG4gIGNhc2hBY2NvdW50VHJuQW10OiBudW1iZXI7XHJcbiAgY2hhcmdlRXh0ZXJuYWxUb0NhcmRDb21tZW50OiBzdHJpbmc7XHJcbiAgY29tbWVudHM6IFtdO1xyXG4gIGN1clBheW1lbnROdW06IG51bWJlcjtcclxuICBkZWJDcmRDdXJyZW5jeVN5bWJvbDogQ3VycmVuY3lTeW1ib2w7XHJcbiAgZGViQ3JkRGF0ZTogc3RyaW5nO1xyXG4gIGRlYml0U3ByZWFkSW5kOiBib29sZWFuO1xyXG4gIGRpc2NvdW50QW1vdW50OiB1bmtub3duO1xyXG4gIGRpc2NvdW50UmVhc29uOiB1bmtub3duO1xyXG4gIGltbWVkaWF0ZUNvbW1lbnRzOiBbXTtcclxuICBpc0ltbWVkaWF0ZUNvbW1lbnRJbmQ6IGJvb2xlYW47XHJcbiAgaXNJbW1lZGlhdGVISEtJbmQ6IGJvb2xlYW47XHJcbiAgaXNNYXJnYXJpdGE6IGJvb2xlYW47XHJcbiAgaXNTcHJlYWRQYXltZW5zdEFicm9hZDogYm9vbGVhbjtcclxuICBsaW5rZWRDb21tZW50czogW107XHJcbiAgbWVyY2hhbnRBZGRyZXNzOiBzdHJpbmc7XHJcbiAgbWVyY2hhbnROYW1lOiBzdHJpbmc7XHJcbiAgbWVyY2hhbnRQaG9uZU5vOiBzdHJpbmc7XHJcbiAgbnVtT2ZQYXltZW50czogbnVtYmVyO1xyXG4gIG9uR29pbmdUcmFuc2FjdGlvbnNDb21tZW50OiBzdHJpbmc7XHJcbiAgcmVmdW5kSW5kOiBib29sZWFuO1xyXG4gIHJvdW5kaW5nQW1vdW50OiB1bmtub3duO1xyXG4gIHJvdW5kaW5nUmVhc29uOiB1bmtub3duO1xyXG4gIHRva2VuSW5kOiAwO1xyXG4gIHRva2VuTnVtYmVyUGFydDQ6ICcnO1xyXG4gIHRyYW5zQ2FyZFByZXNlbnRJbmQ6IGJvb2xlYW47XHJcbiAgdHJhbnNUeXBlQ29tbWVudERldGFpbHM6IFtdO1xyXG4gIHRybkFtdDogbnVtYmVyO1xyXG4gIHRybkN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcclxuICB0cm5FeGFjV2F5OiBudW1iZXI7XHJcbiAgdHJuSW50SWQ6IHN0cmluZztcclxuICB0cm5OdW1hcmV0b3I6IG51bWJlcjtcclxuICB0cm5QdXJjaGFzZURhdGU6IHN0cmluZztcclxuICB0cm5UeXBlOiBzdHJpbmc7XHJcbiAgdHJuVHlwZUNvZGU6IFRyblR5cGVDb2RlO1xyXG4gIHdhbGxldFByb3ZpZGVyQ29kZTogMDtcclxuICB3YWxsZXRQcm92aWRlckRlc2M6ICcnO1xyXG4gIGVhcmx5UGF5bWVudEluZDogYm9vbGVhbjtcclxufVxyXG5pbnRlcmZhY2UgU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbiB7XHJcbiAgbWVyY2hhbnRJRDogc3RyaW5nO1xyXG4gIG1lcmNoYW50TmFtZTogc3RyaW5nO1xyXG4gIHRyblB1cmNoYXNlRGF0ZTogc3RyaW5nO1xyXG4gIHdhbGxldFRyYW5JbmQ6IG51bWJlcjtcclxuICB0cmFuc2FjdGlvbnNPcmlnaW46IG51bWJlcjtcclxuICB0cm5BbXQ6IG51bWJlcjtcclxuICB0cGFBcHByb3ZhbEFtb3VudDogdW5rbm93bjtcclxuICB0cm5DdXJyZW5jeVN5bWJvbDogQ3VycmVuY3lTeW1ib2w7XHJcbiAgdHJuVHlwZUNvZGU6IFRyblR5cGVDb2RlO1xyXG4gIHRyblR5cGU6IHN0cmluZztcclxuICBicmFuY2hDb2RlRGVzYzogc3RyaW5nO1xyXG4gIHRyYW5zQ2FyZFByZXNlbnRJbmQ6IGJvb2xlYW47XHJcbiAgajVJbmRpY2F0b3I6IHN0cmluZztcclxuICBudW1iZXJPZlBheW1lbnRzOiBudW1iZXI7XHJcbiAgZmlyc3RQYXltZW50QW1vdW50OiBudW1iZXI7XHJcbiAgdHJhbnNUeXBlQ29tbWVudERldGFpbHM6IFtdO1xyXG59XHJcbmludGVyZmFjZSBJbml0UmVzcG9uc2Uge1xyXG4gIHJlc3VsdDoge1xyXG4gICAgY2FyZHM6IHtcclxuICAgICAgY2FyZFVuaXF1ZUlkOiBzdHJpbmc7XHJcbiAgICAgIGxhc3Q0RGlnaXRzOiBzdHJpbmc7XHJcbiAgICAgIFtrZXk6IHN0cmluZ106IHVua25vd247XHJcbiAgICB9W107XHJcbiAgfTtcclxufVxyXG50eXBlIEN1cnJlbmN5U3ltYm9sID0gc3RyaW5nO1xyXG5pbnRlcmZhY2UgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yIHtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxufVxyXG5pbnRlcmZhY2UgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyBleHRlbmRzIENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvciB7XHJcbiAgcmVzdWx0OiB7XHJcbiAgICBiYW5rQWNjb3VudHM6IHtcclxuICAgICAgYmFua0FjY291bnROdW06IHN0cmluZztcclxuICAgICAgYmFua05hbWU6IHN0cmluZztcclxuICAgICAgY2hvaWNlRXh0ZXJuYWxUcmFuc2FjdGlvbnM6IGFueTtcclxuICAgICAgY3VycmVudEJhbmtBY2NvdW50SW5kOiBib29sZWFuO1xyXG4gICAgICBkZWJpdERhdGVzOiB7XHJcbiAgICAgICAgYmFza2V0QW1vdW50Q29tbWVudDogdW5rbm93bjtcclxuICAgICAgICBjaG9pY2VISEtEZWJpdDogbnVtYmVyO1xyXG4gICAgICAgIGRhdGU6IHN0cmluZztcclxuICAgICAgICBkZWJpdFJlYXNvbjogdW5rbm93bjtcclxuICAgICAgICBmaXhEZWJpdEFtb3VudDogbnVtYmVyO1xyXG4gICAgICAgIGZyb21QdXJjaGFzZURhdGU6IHN0cmluZztcclxuICAgICAgICBpc0Nob2ljZVJlcGFpbWVudDogYm9vbGVhbjtcclxuICAgICAgICB0b1B1cmNoYXNlRGF0ZTogc3RyaW5nO1xyXG4gICAgICAgIHRvdGFsQmFza2V0QW1vdW50OiBudW1iZXI7XHJcbiAgICAgICAgdG90YWxEZWJpdHM6IHtcclxuICAgICAgICAgIGN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcclxuICAgICAgICAgIGFtb3VudDogbnVtYmVyO1xyXG4gICAgICAgIH1bXTtcclxuICAgICAgICB0cmFuc2FjdGlvbnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdO1xyXG4gICAgICB9W107XHJcbiAgICAgIGltbWlkaWF0ZURlYml0czogeyB0b3RhbERlYml0czogW107IGRlYml0RGF5czogW10gfTtcclxuICAgIH1bXTtcclxuICAgIGJsb2NrZWRDYXJkSW5kOiBib29sZWFuO1xyXG4gIH07XHJcbiAgc3RhdHVzQ29kZTogMTtcclxuICBzdGF0dXNEZXNjcmlwdGlvbjogc3RyaW5nO1xyXG4gIHN0YXR1c1RpdGxlOiBzdHJpbmc7XHJcbn1cclxuaW50ZXJmYWNlIENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzIGV4dGVuZHMgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yIHtcclxuICByZXN1bHQ6IHtcclxuICAgIGNhcmRzTGlzdDoge1xyXG4gICAgICBjYXJkVW5pcXVlSUQ6IHN0cmluZztcclxuICAgICAgYXV0aERldGFsaXNMaXN0OiBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uW107XHJcbiAgICB9W107XHJcbiAgfTtcclxuICBzdGF0dXNDb2RlOiAxO1xyXG4gIHN0YXR1c0Rlc2NyaXB0aW9uOiBzdHJpbmc7XHJcbiAgc3RhdHVzVGl0bGU6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIENhcmRMZXZlbEZyYW1lIHtcclxuICBjYXJkVW5pcXVlSWQ6IHN0cmluZztcclxuICBuZXh0VG90YWxEZWJpdD86IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIEZyYW1lc1Jlc3BvbnNlIHtcclxuICByZXN1bHQ/OiB7XHJcbiAgICBiYW5rSXNzdWVkQ2FyZHM/OiB7XHJcbiAgICAgIGNhcmRMZXZlbEZyYW1lcz86IENhcmRMZXZlbEZyYW1lW107XHJcbiAgICB9O1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBBdXRoTW9kdWxlIHtcclxuICBhdXRoOiB7XHJcbiAgICBjYWxDb25uZWN0VG9rZW46IHN0cmluZyB8IG51bGw7XHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNBdXRoTW9kdWxlKHJlc3VsdDogYW55KTogcmVzdWx0IGlzIEF1dGhNb2R1bGUge1xyXG4gIHJldHVybiBCb29sZWFuKHJlc3VsdD8uYXV0aD8uY2FsQ29ubmVjdFRva2VuICYmIFN0cmluZyhyZXN1bHQuYXV0aC5jYWxDb25uZWN0VG9rZW4pLnRyaW0oKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGF1dGhNb2R1bGVPclVuZGVmaW5lZChyZXN1bHQ6IGFueSk6IEF1dGhNb2R1bGUgfCB1bmRlZmluZWQge1xyXG4gIHJldHVybiBpc0F1dGhNb2R1bGUocmVzdWx0KSA/IHJlc3VsdCA6IHVuZGVmaW5lZDtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNQZW5kaW5nKFxyXG4gIHRyYW5zYWN0aW9uOiBTY3JhcGVkVHJhbnNhY3Rpb24gfCBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uLFxyXG4pOiB0cmFuc2FjdGlvbiBpcyBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uIHtcclxuICByZXR1cm4gKHRyYW5zYWN0aW9uIGFzIFNjcmFwZWRUcmFuc2FjdGlvbikuZGViQ3JkRGF0ZSA9PT0gdW5kZWZpbmVkOyAvLyBhbiBhcmJpdHJhcnkgZmllbGQgdGhhdCBvbmx5IGFwcGVhcnMgaW4gYSBjb21wbGV0ZWQgdHJhbnNhY3Rpb25cclxufVxyXG5cclxuZnVuY3Rpb24gaXNDYXJkVHJhbnNhY3Rpb25EZXRhaWxzKFxyXG4gIHJlc3VsdDogQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyB8IENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvcixcclxuKTogcmVzdWx0IGlzIENhcmRUcmFuc2FjdGlvbkRldGFpbHMge1xyXG4gIHJldHVybiAocmVzdWx0IGFzIENhcmRUcmFuc2FjdGlvbkRldGFpbHMpLnJlc3VsdCAhPT0gdW5kZWZpbmVkO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0NhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzKFxyXG4gIHJlc3VsdDogQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMgfCBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzRXJyb3IsXHJcbik6IHJlc3VsdCBpcyBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB7XHJcbiAgcmV0dXJuIChyZXN1bHQgYXMgQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMpLnJlc3VsdCAhPT0gdW5kZWZpbmVkO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRMb2dpbkZyYW1lKHBhZ2U6IFBhZ2UpIHtcclxuICBsZXQgZnJhbWU6IEZyYW1lIHwgbnVsbCA9IG51bGw7XHJcbiAgZGVidWcoJ3dhaXQgdW50aWwgbG9naW4gZnJhbWUgZm91bmQnKTtcclxuICBhd2FpdCB3YWl0VW50aWwoXHJcbiAgICAoKSA9PiB7XHJcbiAgICAgIGZyYW1lID0gcGFnZS5mcmFtZXMoKS5maW5kKGYgPT4gZi51cmwoKS5pbmNsdWRlcygnY29ubmVjdCcpKSB8fCBudWxsO1xyXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCEhZnJhbWUpO1xyXG4gICAgfSxcclxuICAgICd3YWl0IGZvciBpZnJhbWUgd2l0aCBsb2dpbiBmb3JtJyxcclxuICAgIDEwMDAwLFxyXG4gICAgMTAwMCxcclxuICApO1xyXG5cclxuICBpZiAoIWZyYW1lKSB7XHJcbiAgICBkZWJ1ZygnZmFpbGVkIHRvIGZpbmQgbG9naW4gZnJhbWUgZm9yIDEwIHNlY29uZHMnKTtcclxuICAgIHRocm93IG5ldyBFcnJvcignZmFpbGVkIHRvIGV4dHJhY3QgbG9naW4gaWZyYW1lJyk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZnJhbWU7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhc0ludmFsaWRQYXNzd29yZEVycm9yKHBhZ2U6IFBhZ2UpIHtcclxuICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldExvZ2luRnJhbWUocGFnZSk7XHJcbiAgY29uc3QgZXJyb3JGb3VuZCA9IGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKGZyYW1lLCAnZGl2LmdlbmVyYWwtZXJyb3IgPiBkaXYnKTtcclxuICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvckZvdW5kXHJcbiAgICA/IGF3YWl0IHBhZ2VFdmFsKGZyYW1lLCAnZGl2LmdlbmVyYWwtZXJyb3IgPiBkaXYnLCAnJywgaXRlbSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIChpdGVtIGFzIEhUTUxEaXZFbGVtZW50KS5pbm5lclRleHQ7XHJcbiAgICAgIH0pXHJcbiAgICA6ICcnO1xyXG4gIHJldHVybiBlcnJvck1lc3NhZ2UgPT09IEludmFsaWRQYXNzd29yZE1lc3NhZ2U7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhc0NoYW5nZVBhc3N3b3JkRm9ybShwYWdlOiBQYWdlKSB7XHJcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHBhZ2UpO1xyXG4gIGNvbnN0IGVycm9yRm91bmQgPSBhd2FpdCBlbGVtZW50UHJlc2VudE9uUGFnZShmcmFtZSwgJy5jaGFuZ2UtcGFzc3dvcmQtc3VidGl0bGUnKTtcclxuICByZXR1cm4gZXJyb3JGb3VuZDtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0UG9zc2libGVMb2dpblJlc3VsdHMoKSB7XHJcbiAgZGVidWcoJ3JldHVybiBwb3NzaWJsZSBsb2dpbiByZXN1bHRzJyk7XHJcbiAgY29uc3QgdXJsczogTG9naW5PcHRpb25zWydwb3NzaWJsZVJlc3VsdHMnXSA9IHtcclxuICAgIFtMb2dpblJlc3VsdHMuU3VjY2Vzc106IFsvZGFzaGJvYXJkL2ldLFxyXG4gICAgW0xvZ2luUmVzdWx0cy5JbnZhbGlkUGFzc3dvcmRdOiBbXHJcbiAgICAgIGFzeW5jIChvcHRpb25zPzogeyBwYWdlPzogUGFnZSB9KSA9PiB7XHJcbiAgICAgICAgY29uc3QgcGFnZSA9IG9wdGlvbnM/LnBhZ2U7XHJcbiAgICAgICAgaWYgKCFwYWdlKSB7XHJcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBoYXNJbnZhbGlkUGFzc3dvcmRFcnJvcihwYWdlKTtcclxuICAgICAgfSxcclxuICAgIF0sXHJcbiAgICAvLyBbTG9naW5SZXN1bHRzLkFjY291bnRCbG9ja2VkXTogW10sIC8vIFRPRE8gYWRkIHdoZW4gcmVhY2hpbmcgdGhpcyBzY2VuYXJpb1xyXG4gICAgW0xvZ2luUmVzdWx0cy5DaGFuZ2VQYXNzd29yZF06IFtcclxuICAgICAgYXN5bmMgKG9wdGlvbnM/OiB7IHBhZ2U/OiBQYWdlIH0pID0+IHtcclxuICAgICAgICBjb25zdCBwYWdlID0gb3B0aW9ucz8ucGFnZTtcclxuICAgICAgICBpZiAoIXBhZ2UpIHtcclxuICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGhhc0NoYW5nZVBhc3N3b3JkRm9ybShwYWdlKTtcclxuICAgICAgfSxcclxuICAgIF0sXHJcbiAgfTtcclxuICByZXR1cm4gdXJscztcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKSB7XHJcbiAgZGVidWcoJ2NyZWF0ZSBsb2dpbiBmaWVsZHMgZm9yIHVzZXJuYW1lIGFuZCBwYXNzd29yZCcpO1xyXG4gIHJldHVybiBbXHJcbiAgICB7IHNlbGVjdG9yOiAnW2Zvcm1jb250cm9sbmFtZT1cInVzZXJOYW1lXCJdJywgdmFsdWU6IGNyZWRlbnRpYWxzLnVzZXJuYW1lIH0sXHJcbiAgICB7IHNlbGVjdG9yOiAnW2Zvcm1jb250cm9sbmFtZT1cInBhc3N3b3JkXCJdJywgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXHJcbiAgXTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29udmVydFBhcnNlZERhdGFUb1RyYW5zYWN0aW9ucyhcclxuICBkYXRhOiBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzW10sXHJcbiAgcGVuZGluZ0RhdGE/OiBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB8IG51bGwsXHJcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxyXG4pOiBUcmFuc2FjdGlvbltdIHtcclxuICBjb25zdCBwZW5kaW5nVHJhbnNhY3Rpb25zID0gcGVuZGluZ0RhdGE/LnJlc3VsdFxyXG4gICAgPyBwZW5kaW5nRGF0YS5yZXN1bHQuY2FyZHNMaXN0LmZsYXRNYXAoY2FyZCA9PiBjYXJkLmF1dGhEZXRhbGlzTGlzdClcclxuICAgIDogW107XHJcblxyXG4gIGNvbnN0IGJhbmtBY2NvdW50cyA9IGRhdGEuZmxhdE1hcChtb250aERhdGEgPT4gbW9udGhEYXRhLnJlc3VsdC5iYW5rQWNjb3VudHMpO1xyXG4gIGNvbnN0IHJlZ3VsYXJEZWJpdERheXMgPSBiYW5rQWNjb3VudHMuZmxhdE1hcChhY2NvdW50cyA9PiBhY2NvdW50cy5kZWJpdERhdGVzKTtcclxuICBjb25zdCBpbW1lZGlhdGVEZWJpdERheXMgPSBiYW5rQWNjb3VudHMuZmxhdE1hcChhY2NvdW50cyA9PiBhY2NvdW50cy5pbW1pZGlhdGVEZWJpdHMuZGViaXREYXlzKTtcclxuICBjb25zdCBjb21wbGV0ZWRUcmFuc2FjdGlvbnMgPSBbLi4ucmVndWxhckRlYml0RGF5cywgLi4uaW1tZWRpYXRlRGViaXREYXlzXS5mbGF0TWFwKFxyXG4gICAgZGViaXREYXRlID0+IGRlYml0RGF0ZS50cmFuc2FjdGlvbnMsXHJcbiAgKTtcclxuXHJcbiAgY29uc3QgYWxsOiAoU2NyYXBlZFRyYW5zYWN0aW9uIHwgU2NyYXBlZFBlbmRpbmdUcmFuc2FjdGlvbilbXSA9IFsuLi5wZW5kaW5nVHJhbnNhY3Rpb25zLCAuLi5jb21wbGV0ZWRUcmFuc2FjdGlvbnNdO1xyXG5cclxuICByZXR1cm4gYWxsLm1hcCh0cmFuc2FjdGlvbiA9PiB7XHJcbiAgICBjb25zdCBudW1PZlBheW1lbnRzID0gaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IHRyYW5zYWN0aW9uLm51bWJlck9mUGF5bWVudHMgOiB0cmFuc2FjdGlvbi5udW1PZlBheW1lbnRzO1xyXG4gICAgY29uc3QgaW5zdGFsbG1lbnRzID0gbnVtT2ZQYXltZW50c1xyXG4gICAgICA/IHtcclxuICAgICAgICAgIG51bWJlcjogaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IDEgOiB0cmFuc2FjdGlvbi5jdXJQYXltZW50TnVtLFxyXG4gICAgICAgICAgdG90YWw6IG51bU9mUGF5bWVudHMsXHJcbiAgICAgICAgfVxyXG4gICAgICA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICBjb25zdCBkYXRlID0gbW9tZW50KHRyYW5zYWN0aW9uLnRyblB1cmNoYXNlRGF0ZSk7XHJcblxyXG4gICAgY29uc3QgY2hhcmdlZEFtb3VudCA9IChpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24udHJuQW10IDogdHJhbnNhY3Rpb24uYW10QmVmb3JlQ29udkFuZEluZGV4KSAqIC0xO1xyXG4gICAgY29uc3Qgb3JpZ2luYWxBbW91bnQgPSB0cmFuc2FjdGlvbi50cm5BbXQgKiAodHJhbnNhY3Rpb24udHJuVHlwZUNvZGUgPT09IFRyblR5cGVDb2RlLmNyZWRpdCA/IDEgOiAtMSk7XHJcblxyXG4gICAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbiA9IHtcclxuICAgICAgaWRlbnRpZmllcjogIWlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi50cm5JbnRJZCA6IHVuZGVmaW5lZCxcclxuICAgICAgdHlwZTogW1RyblR5cGVDb2RlLnJlZ3VsYXIsIFRyblR5cGVDb2RlLnN0YW5kaW5nT3JkZXJdLmluY2x1ZGVzKHRyYW5zYWN0aW9uLnRyblR5cGVDb2RlKVxyXG4gICAgICAgID8gVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWxcclxuICAgICAgICA6IFRyYW5zYWN0aW9uVHlwZXMuSW5zdGFsbG1lbnRzLFxyXG4gICAgICBzdGF0dXM6IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyBUcmFuc2FjdGlvblN0YXR1c2VzLlBlbmRpbmcgOiBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcclxuICAgICAgZGF0ZTogaW5zdGFsbG1lbnRzID8gZGF0ZS5hZGQoaW5zdGFsbG1lbnRzLm51bWJlciAtIDEsICdtb250aCcpLnRvSVNPU3RyaW5nKCkgOiBkYXRlLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHByb2Nlc3NlZERhdGU6IGlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyBkYXRlLnRvSVNPU3RyaW5nKCkgOiBuZXcgRGF0ZSh0cmFuc2FjdGlvbi5kZWJDcmREYXRlKS50b0lTT1N0cmluZygpLFxyXG4gICAgICBvcmlnaW5hbEFtb3VudCxcclxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogdHJhbnNhY3Rpb24udHJuQ3VycmVuY3lTeW1ib2wsXHJcbiAgICAgIGNoYXJnZWRBbW91bnQsXHJcbiAgICAgIGNoYXJnZWRDdXJyZW5jeTogIWlzUGVuZGluZyh0cmFuc2FjdGlvbikgPyB0cmFuc2FjdGlvbi5kZWJDcmRDdXJyZW5jeVN5bWJvbCA6IHVuZGVmaW5lZCxcclxuICAgICAgZGVzY3JpcHRpb246IHRyYW5zYWN0aW9uLm1lcmNoYW50TmFtZSxcclxuICAgICAgbWVtbzogdHJhbnNhY3Rpb24udHJhbnNUeXBlQ29tbWVudERldGFpbHMudG9TdHJpbmcoKSxcclxuICAgICAgY2F0ZWdvcnk6IHRyYW5zYWN0aW9uLmJyYW5jaENvZGVEZXNjLFxyXG4gICAgfTtcclxuXHJcbiAgICBpZiAoaW5zdGFsbG1lbnRzKSB7XHJcbiAgICAgIHJlc3VsdC5pbnN0YWxsbWVudHMgPSBpbnN0YWxsbWVudHM7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG9wdGlvbnM/LmluY2x1ZGVSYXdUcmFuc2FjdGlvbikge1xyXG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0cmFuc2FjdGlvbik7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9KTtcclxufVxyXG5cclxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHsgdXNlcm5hbWU6IHN0cmluZzsgcGFzc3dvcmQ6IHN0cmluZyB9O1xyXG5cclxuY2xhc3MgVmlzYUNhbFNjcmFwZXIgZXh0ZW5kcyBCYXNlU2NyYXBlcldpdGhCcm93c2VyPFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzPiB7XHJcbiAgcHJpdmF0ZSBhdXRob3JpemF0aW9uOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XHJcblxyXG4gIHByaXZhdGUgYXV0aFJlcXVlc3RQcm9taXNlOiBQcm9taXNlPEhUVFBSZXF1ZXN0IHwgdW5kZWZpbmVkPiB8IHVuZGVmaW5lZDtcclxuXHJcbiAgb3BlbkxvZ2luUG9wdXAgPSBhc3luYyAoKSA9PiB7XHJcbiAgICBkZWJ1Zygnb3BlbiBsb2dpbiBwb3B1cCwgd2FpdCB1bnRpbCBsb2dpbiBidXR0b24gYXZhaWxhYmxlJyk7XHJcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQodGhpcy5wYWdlLCAnI2NjTG9naW5EZXNrdG9wQnRuJywgdHJ1ZSk7XHJcbiAgICBkZWJ1ZygnY2xpY2sgb24gdGhlIGxvZ2luIGJ1dHRvbicpO1xyXG4gICAgYXdhaXQgY2xpY2tCdXR0b24odGhpcy5wYWdlLCAnI2NjTG9naW5EZXNrdG9wQnRuJyk7XHJcbiAgICBkZWJ1ZygnZ2V0IHRoZSBmcmFtZSB0aGF0IGhvbGRzIHRoZSBsb2dpbicpO1xyXG4gICAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHRoaXMucGFnZSk7XHJcbiAgICBkZWJ1Zygnd2FpdCB1bnRpbCB0aGUgcGFzc3dvcmQgbG9naW4gdGFiIGhlYWRlciBpcyBhdmFpbGFibGUnKTtcclxuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChmcmFtZSwgJyNyZWd1bGFyLWxvZ2luJyk7XHJcbiAgICBkZWJ1ZygnbmF2aWdhdGUgdG8gdGhlIHBhc3N3b3JkIGxvZ2luIHRhYicpO1xyXG4gICAgYXdhaXQgY2xpY2tCdXR0b24oZnJhbWUsICcjcmVndWxhci1sb2dpbicpO1xyXG4gICAgZGVidWcoJ3dhaXQgdW50aWwgdGhlIHBhc3N3b3JkIGxvZ2luIHRhYiBpcyBhY3RpdmUnKTtcclxuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChmcmFtZSwgJ3JlZ3VsYXItbG9naW4nKTtcclxuXHJcbiAgICByZXR1cm4gZnJhbWU7XHJcbiAgfTtcclxuXHJcbiAgYXN5bmMgZ2V0Q2FyZHMoKSB7XHJcbiAgICBjb25zdCBpbml0RGF0YSA9IGF3YWl0IHdhaXRVbnRpbChcclxuICAgICAgKCkgPT4gZ2V0RnJvbVNlc3Npb25TdG9yYWdlPEluaXRSZXNwb25zZT4odGhpcy5wYWdlLCAnaW5pdCcpLFxyXG4gICAgICAnZ2V0IGluaXQgZGF0YSBpbiBzZXNzaW9uIHN0b3JhZ2UnLFxyXG4gICAgICAxMDAwMCxcclxuICAgICAgMTAwMCxcclxuICAgICk7XHJcbiAgICBpZiAoIWluaXREYXRhKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignY291bGQgbm90IGZpbmQgXCJpbml0XCIgZGF0YSBpbiBzZXNzaW9uIHN0b3JhZ2UnKTtcclxuICAgIH1cclxuICAgIHJldHVybiBpbml0RGF0YT8ucmVzdWx0LmNhcmRzLm1hcCgoeyBjYXJkVW5pcXVlSWQsIGxhc3Q0RGlnaXRzIH0pID0+ICh7IGNhcmRVbmlxdWVJZCwgbGFzdDREaWdpdHMgfSkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0QXV0aG9yaXphdGlvbkhlYWRlcigpIHtcclxuICAgIGlmICghdGhpcy5hdXRob3JpemF0aW9uKSB7XHJcbiAgICAgIGRlYnVnKCdmZXRjaGluZyBhdXRob3JpemF0aW9uIGhlYWRlcicpO1xyXG4gICAgICBjb25zdCBhdXRoTW9kdWxlID0gYXdhaXQgd2FpdFVudGlsKFxyXG4gICAgICAgIGFzeW5jICgpID0+IGF1dGhNb2R1bGVPclVuZGVmaW5lZChhd2FpdCBnZXRGcm9tU2Vzc2lvblN0b3JhZ2U8QXV0aE1vZHVsZT4odGhpcy5wYWdlLCAnYXV0aC1tb2R1bGUnKSksXHJcbiAgICAgICAgJ2dldCBhdXRob3JpemF0aW9uIGhlYWRlciB3aXRoIHZhbGlkIHRva2VuIGluIHNlc3Npb24gc3RvcmFnZScsXHJcbiAgICAgICAgMTBfMDAwLFxyXG4gICAgICAgIDUwLFxyXG4gICAgICApO1xyXG4gICAgICByZXR1cm4gYENBTEF1dGhTY2hlbWUgJHthdXRoTW9kdWxlLmF1dGguY2FsQ29ubmVjdFRva2VufWA7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5hdXRob3JpemF0aW9uO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0WFNpdGVJZCgpIHtcclxuICAgIC8qXHJcbiAgICAgIEkgZG9uJ3Qga25vdyBpZiB0aGUgY29uc3RhbnQgYmVsb3cgd2lsbCBjaGFuZ2UgaW4gdGhlIGZlYXR1cmUuXHJcbiAgICAgIElmIHNvLCB1c2UgdGhlIG5leHQgY29kZTpcclxuXHJcbiAgICAgIHJldHVybiB0aGlzLnBhZ2UuZXZhbHVhdGUoKCkgPT4gbmV3IFV0KCkueFNpdGVJZCk7XHJcblxyXG4gICAgICBUbyBnZXQgdGhlIGNsYXNzbmFtZSBzZWFyY2ggZm9yICd4U2l0ZUlkJyBpbiB0aGUgcGFnZSBzb3VyY2VcclxuICAgICAgY2xhc3MgVXQge1xyXG4gICAgICAgIGNvbnN0cnVjdG9yKF9lLCBvbiwgeW4pIHtcclxuICAgICAgICAgICAgdGhpcy5zdG9yZSA9IF9lLFxyXG4gICAgICAgICAgICB0aGlzLmNvbmZpZyA9IG9uLFxyXG4gICAgICAgICAgICB0aGlzLmV2ZW50QnVzU2VydmljZSA9IHluLFxyXG4gICAgICAgICAgICB0aGlzLnhTaXRlSWQgPSBcIjA5MDMxOTg3LTI3M0UtMjMxMS05MDZDLThBRjg1QjE3QzhEOVwiLFxyXG4gICAgKi9cclxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoJzA5MDMxOTg3LTI3M0UtMjMxMS05MDZDLThBRjg1QjE3QzhEOScpO1xyXG4gIH1cclxuXHJcbiAgZ2V0TG9naW5PcHRpb25zKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyk6IExvZ2luT3B0aW9ucyB7XHJcbiAgICB0aGlzLmF1dGhSZXF1ZXN0UHJvbWlzZSA9IHRoaXMucGFnZVxyXG4gICAgICAud2FpdEZvclJlcXVlc3QoU1NPX0FVVEhPUklaQVRJT05fUkVRVUVTVF9FTkRQT0lOVCwgeyB0aW1lb3V0OiAxMF8wMDAgfSlcclxuICAgICAgLmNhdGNoKGUgPT4ge1xyXG4gICAgICAgIGRlYnVnKCdlcnJvciB3aGlsZSB3YWl0aW5nIGZvciB0aGUgdG9rZW4gcmVxdWVzdCcsIGUpO1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgIH0pO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgbG9naW5Vcmw6IGAke0xPR0lOX1VSTH1gLFxyXG4gICAgICBmaWVsZHM6IGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzKSxcclxuICAgICAgc3VibWl0QnV0dG9uU2VsZWN0b3I6ICdidXR0b25bdHlwZT1cInN1Ym1pdFwiXScsXHJcbiAgICAgIHBvc3NpYmxlUmVzdWx0czogZ2V0UG9zc2libGVMb2dpblJlc3VsdHMoKSxcclxuICAgICAgY2hlY2tSZWFkaW5lc3M6IGFzeW5jICgpID0+IHdhaXRVbnRpbEVsZW1lbnRGb3VuZCh0aGlzLnBhZ2UsICcjY2NMb2dpbkRlc2t0b3BCdG4nKSxcclxuICAgICAgcHJlQWN0aW9uOiB0aGlzLm9wZW5Mb2dpblBvcHVwLFxyXG4gICAgICBwb3N0QWN0aW9uOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHRoaXMucGFnZSk7XHJcbiAgICAgICAgICBjb25zdCBjdXJyZW50VXJsID0gYXdhaXQgZ2V0Q3VycmVudFVybCh0aGlzLnBhZ2UpO1xyXG4gICAgICAgICAgaWYgKGN1cnJlbnRVcmwuZW5kc1dpdGgoJ3NpdGUtdHV0b3JpYWwnKSkge1xyXG4gICAgICAgICAgICBhd2FpdCBjbGlja0J1dHRvbih0aGlzLnBhZ2UsICdidXR0b24uYnRuLWNsb3NlJyk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zdCByZXF1ZXN0ID0gYXdhaXQgdGhpcy5hdXRoUmVxdWVzdFByb21pc2U7XHJcbiAgICAgICAgICB0aGlzLmF1dGhvcml6YXRpb24gPSBTdHJpbmcocmVxdWVzdD8uaGVhZGVycygpLmF1dGhvcml6YXRpb24gfHwgJycpLnRyaW0oKTtcclxuICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICBjb25zdCBjdXJyZW50VXJsID0gYXdhaXQgZ2V0Q3VycmVudFVybCh0aGlzLnBhZ2UpO1xyXG4gICAgICAgICAgaWYgKGN1cnJlbnRVcmwuZW5kc1dpdGgoJ2Rhc2hib2FyZCcpKSByZXR1cm47XHJcbiAgICAgICAgICBjb25zdCByZXF1aXJlc0NoYW5nZVBhc3N3b3JkID0gYXdhaXQgaGFzQ2hhbmdlUGFzc3dvcmRGb3JtKHRoaXMucGFnZSk7XHJcbiAgICAgICAgICBpZiAocmVxdWlyZXNDaGFuZ2VQYXNzd29yZCkgcmV0dXJuO1xyXG4gICAgICAgICAgdGhyb3cgZTtcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIHVzZXJBZ2VudDogYXBpSGVhZGVyc1snVXNlci1BZ2VudCddLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGZldGNoRGF0YSgpOiBQcm9taXNlPFNjcmFwZXJTY3JhcGluZ1Jlc3VsdD4ge1xyXG4gICAgY29uc3QgZGVmYXVsdFN0YXJ0TW9tZW50ID0gbW9tZW50KCkuc3VidHJhY3QoMSwgJ3llYXJzJykuc3VidHJhY3QoNiwgJ21vbnRocycpLmFkZCgxLCAnZGF5Jyk7XHJcbiAgICBjb25zdCBzdGFydERhdGUgPSB0aGlzLm9wdGlvbnMuc3RhcnREYXRlIHx8IGRlZmF1bHRTdGFydE1vbWVudC50b0RhdGUoKTtcclxuICAgIGNvbnN0IHN0YXJ0TW9tZW50ID0gbW9tZW50Lm1heChkZWZhdWx0U3RhcnRNb21lbnQsIG1vbWVudChzdGFydERhdGUpKTtcclxuICAgIGRlYnVnKGBmZXRjaCB0cmFuc2FjdGlvbnMgc3RhcnRpbmcgJHtzdGFydE1vbWVudC5mb3JtYXQoKX1gKTtcclxuXHJcbiAgICBjb25zdCBbY2FyZHMsIHhTaXRlSWQsIEF1dGhvcml6YXRpb25dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgICB0aGlzLmdldENhcmRzKCksXHJcbiAgICAgIHRoaXMuZ2V0WFNpdGVJZCgpLFxyXG4gICAgICB0aGlzLmdldEF1dGhvcml6YXRpb25IZWFkZXIoKSxcclxuICAgIF0pO1xyXG5cclxuICAgIGNvbnN0IGZ1dHVyZU1vbnRoc1RvU2NyYXBlID0gdGhpcy5vcHRpb25zLmZ1dHVyZU1vbnRoc1RvU2NyYXBlID8/IDE7XHJcblxyXG4gICAgZGVidWcoJ2ZldGNoIGZyYW1lcyAobWlzZ2Fyb3QpIG9mIGNhcmRzJyk7XHJcbiAgICBjb25zdCBmcmFtZXMgPSBhd2FpdCBmZXRjaFBvc3Q8RnJhbWVzUmVzcG9uc2U+KFxyXG4gICAgICBGUkFNRVNfUkVRVUVTVF9FTkRQT0lOVCxcclxuICAgICAgeyBjYXJkc0ZvckZyYW1lRGF0YTogY2FyZHMubWFwKCh7IGNhcmRVbmlxdWVJZCB9KSA9PiAoeyBjYXJkVW5pcXVlSWQgfSkpIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBBdXRob3JpemF0aW9uLFxyXG4gICAgICAgICdYLVNpdGUtSWQnOiB4U2l0ZUlkLFxyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgLi4uYXBpSGVhZGVycyxcclxuICAgICAgfSxcclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgYWNjb3VudHMgPSBhd2FpdCBQcm9taXNlLmFsbChcclxuICAgICAgY2FyZHMubWFwKGFzeW5jIGNhcmQgPT4ge1xyXG4gICAgICAgIGNvbnN0IGZpbmFsTW9udGhUb0ZldGNoTW9tZW50ID0gbW9tZW50KCkuYWRkKGZ1dHVyZU1vbnRoc1RvU2NyYXBlLCAnbW9udGgnKTtcclxuICAgICAgICBjb25zdCBtb250aHMgPSBmaW5hbE1vbnRoVG9GZXRjaE1vbWVudC5kaWZmKHN0YXJ0TW9tZW50LCAnbW9udGhzJyk7XHJcbiAgICAgICAgY29uc3QgYWxsTW9udGhzRGF0YTogQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc1tdID0gW107XHJcbiAgICAgICAgY29uc3QgZnJhbWUgPSBfLmZpbmQoZnJhbWVzLnJlc3VsdD8uYmFua0lzc3VlZENhcmRzPy5jYXJkTGV2ZWxGcmFtZXMsIHsgY2FyZFVuaXF1ZUlkOiBjYXJkLmNhcmRVbmlxdWVJZCB9KTtcclxuXHJcbiAgICAgICAgZGVidWcoYGZldGNoIHBlbmRpbmcgdHJhbnNhY3Rpb25zIGZvciBjYXJkICR7Y2FyZC5jYXJkVW5pcXVlSWR9YCk7XHJcbiAgICAgICAgbGV0IHBlbmRpbmdEYXRhID0gYXdhaXQgZmV0Y2hQb3N0KFxyXG4gICAgICAgICAgUEVORElOR19UUkFOU0FDVElPTlNfUkVRVUVTVF9FTkRQT0lOVCxcclxuICAgICAgICAgIHsgY2FyZFVuaXF1ZUlEQXJyYXk6IFtjYXJkLmNhcmRVbmlxdWVJZF0gfSxcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgQXV0aG9yaXphdGlvbixcclxuICAgICAgICAgICAgJ1gtU2l0ZS1JZCc6IHhTaXRlSWQsXHJcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICAgIC4uLmFwaUhlYWRlcnMsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICAgIGRlYnVnKGBmZXRjaCBjb21wbGV0ZWQgdHJhbnNhY3Rpb25zIGZvciBjYXJkICR7Y2FyZC5jYXJkVW5pcXVlSWR9YCk7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbW9udGhzOyBpKyspIHtcclxuICAgICAgICAgIGNvbnN0IG1vbnRoID0gZmluYWxNb250aFRvRmV0Y2hNb21lbnQuY2xvbmUoKS5zdWJ0cmFjdChpLCAnbW9udGhzJyk7XHJcbiAgICAgICAgICBjb25zdCBtb250aERhdGEgPSBhd2FpdCBmZXRjaFBvc3QoXHJcbiAgICAgICAgICAgIFRSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5ULFxyXG4gICAgICAgICAgICB7IGNhcmRVbmlxdWVJZDogY2FyZC5jYXJkVW5pcXVlSWQsIG1vbnRoOiBtb250aC5mb3JtYXQoJ00nKSwgeWVhcjogbW9udGguZm9ybWF0KCdZWVlZJykgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIEF1dGhvcml6YXRpb24sXHJcbiAgICAgICAgICAgICAgJ1gtU2l0ZS1JZCc6IHhTaXRlSWQsXHJcbiAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgICAgICAuLi5hcGlIZWFkZXJzLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgICBpZiAobW9udGhEYXRhPy5zdGF0dXNDb2RlICE9PSAxKVxyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgICAgICAgYGZhaWxlZCB0byBmZXRjaCB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmxhc3Q0RGlnaXRzfS4gTWVzc2FnZTogJHttb250aERhdGE/LnRpdGxlIHx8ICcnfWAsXHJcbiAgICAgICAgICAgICk7XHJcblxyXG4gICAgICAgICAgaWYgKCFpc0NhcmRUcmFuc2FjdGlvbkRldGFpbHMobW9udGhEYXRhKSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ21vbnRoRGF0YSBpcyBub3Qgb2YgdHlwZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzJyk7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgYWxsTW9udGhzRGF0YS5wdXNoKG1vbnRoRGF0YSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAocGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDEgJiYgcGVuZGluZ0RhdGE/LnN0YXR1c0NvZGUgIT09IDk2KSB7XHJcbiAgICAgICAgICBkZWJ1ZyhcclxuICAgICAgICAgICAgYGZhaWxlZCB0byBmZXRjaCBwZW5kaW5nIHRyYW5zYWN0aW9ucyBmb3IgY2FyZCAke2NhcmQubGFzdDREaWdpdHN9LiBNZXNzYWdlOiAke3BlbmRpbmdEYXRhPy50aXRsZSB8fCAnJ31gLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHBlbmRpbmdEYXRhID0gbnVsbDtcclxuICAgICAgICB9IGVsc2UgaWYgKCFpc0NhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzKHBlbmRpbmdEYXRhKSkge1xyXG4gICAgICAgICAgZGVidWcoJ3BlbmRpbmdEYXRhIGlzIG5vdCBvZiB0eXBlIENhcmRUcmFuc2FjdGlvbkRldGFpbHMnKTtcclxuICAgICAgICAgIHBlbmRpbmdEYXRhID0gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHRyYW5zYWN0aW9ucyA9IGNvbnZlcnRQYXJzZWREYXRhVG9UcmFuc2FjdGlvbnMoYWxsTW9udGhzRGF0YSwgcGVuZGluZ0RhdGEsIHRoaXMub3B0aW9ucyk7XHJcblxyXG4gICAgICAgIGRlYnVnKCdmaWx0ZXIgb3V0IG9sZCB0cmFuc2FjdGlvbnMnKTtcclxuICAgICAgICBjb25zdCB0eG5zID1cclxuICAgICAgICAgICh0aGlzLm9wdGlvbnMub3V0cHV0RGF0YT8uZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlID8/IHRydWUpXHJcbiAgICAgICAgICAgID8gZmlsdGVyT2xkVHJhbnNhY3Rpb25zKHRyYW5zYWN0aW9ucywgbW9tZW50KHN0YXJ0RGF0ZSksIHRoaXMub3B0aW9ucy5jb21iaW5lSW5zdGFsbG1lbnRzIHx8IGZhbHNlKVxyXG4gICAgICAgICAgICA6IHRyYW5zYWN0aW9ucztcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHR4bnMsXHJcbiAgICAgICAgICBiYWxhbmNlOiBmcmFtZT8ubmV4dFRvdGFsRGViaXQgIT0gbnVsbCA/IC1mcmFtZS5uZXh0VG90YWxEZWJpdCA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgIGFjY291bnROdW1iZXI6IGNhcmQubGFzdDREaWdpdHMsXHJcbiAgICAgICAgfSBhcyBUcmFuc2FjdGlvbnNBY2NvdW50O1xyXG4gICAgICB9KSxcclxuICAgICk7XHJcblxyXG4gICAgZGVidWcoJ3JldHVybiB0aGUgc2NyYXBlZCBhY2NvdW50cycpO1xyXG5cclxuICAgIGRlYnVnKEpTT04uc3RyaW5naWZ5KGFjY291bnRzLCBudWxsLCAyKSk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICBhY2NvdW50cyxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBWaXNhQ2FsU2NyYXBlcjtcclxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxJQUFBQSxPQUFBLEdBQUFDLHNCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBQyxNQUFBLEdBQUFELE9BQUE7QUFDQSxJQUFBRSxxQkFBQSxHQUFBRixPQUFBO0FBQ0EsSUFBQUcsTUFBQSxHQUFBSCxPQUFBO0FBQ0EsSUFBQUksV0FBQSxHQUFBSixPQUFBO0FBQ0EsSUFBQUssUUFBQSxHQUFBTCxPQUFBO0FBQ0EsSUFBQU0sYUFBQSxHQUFBTixPQUFBO0FBQ0EsSUFBQU8sUUFBQSxHQUFBUCxPQUFBO0FBQ0EsSUFBQVEsY0FBQSxHQUFBUixPQUFBO0FBQ0EsSUFBQVMsdUJBQUEsR0FBQVQsT0FBQTtBQUVBLElBQUFVLE9BQUEsR0FBQVgsc0JBQUEsQ0FBQUMsT0FBQTtBQUF1QixTQUFBRCx1QkFBQVksQ0FBQSxXQUFBQSxDQUFBLElBQUFBLENBQUEsQ0FBQUMsVUFBQSxHQUFBRCxDQUFBLEtBQUFFLE9BQUEsRUFBQUYsQ0FBQTtBQUV2QixN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