"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clickAccountSelectorGetAccountIds = clickAccountSelectorGetAccountIds;
exports.createLoginFields = createLoginFields;
exports.default = void 0;
exports.getPossibleLoginResults = getPossibleLoginResults;
exports.selectAccountFromDropdown = selectAccountFromDropdown;
exports.waitForPostLogin = waitForPostLogin;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _elementsInteractions = require("../helpers/elements-interactions");
var _navigation = require("../helpers/navigation");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';
const IFRAME_NAME = 'iframe-old-pages';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;
function getPossibleLoginResults() {
  const urls = {};
  urls[_baseScraperWithBrowser.LoginResults.Success] = [/fibi.*accountSummary/,
  // New UI pattern
  /Resources\/PortalNG\/shell/,
  // New UI pattern
  /FibiMenu\/Online/ // Old UI pattern
  ];
  urls[_baseScraperWithBrowser.LoginResults.InvalidPassword] = [/FibiMenu\/Marketing\/Private\/Home/];
  return urls;
}
function createLoginFields(credentials) {
  return [{
    selector: '#username',
    value: credentials.username
  }, {
    selector: '#password',
    value: credentials.password
  }];
}
function getAmountData(amountStr) {
  let amountStrCopy = amountStr.replace(_constants.SHEKEL_CURRENCY_SYMBOL, '');
  amountStrCopy = amountStrCopy.replaceAll(',', '');
  return parseFloat(amountStrCopy);
}
function getTxnAmount(txn) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}
function convertTransactions(txns, options) {
  return txns.map(txn => {
    const convertedDate = (0, _moment.default)(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    const result = {
      type: _transactions2.TransactionTypes.Normal,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: convertedDate,
      processedDate: convertedDate,
      originalAmount: convertedAmount,
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: convertedAmount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
function getTransactionDate(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionDescription(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionReference(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[REFERENCE_COLUMN_CLASS]] || '').trim();
}
function getTransactionDebit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DEBIT_COLUMN_CLASS]] || '').trim();
}
function getTransactionCredit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[CREDIT_COLUMN_CLASS]] || '').trim();
}
function extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes) {
  const tds = txnRow.innerTds;
  const item = {
    status: transactionStatus,
    date: getTransactionDate(tds, transactionStatus, transactionsColsTypes),
    description: getTransactionDescription(tds, transactionStatus, transactionsColsTypes),
    reference: getTransactionReference(tds, transactionsColsTypes),
    debit: getTransactionDebit(tds, transactionsColsTypes),
    credit: getTransactionCredit(tds, transactionsColsTypes)
  };
  return item;
}
async function getTransactionsColsTypeClasses(page, tableLocator) {
  const result = {};
  const typeClassesObjs = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr:first-of-type td`, null, tds => {
    return tds.map((td, index) => ({
      colClass: td.getAttribute('class'),
      index
    }));
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) {
      result[typeClassObj.colClass] = typeClassObj.index;
    }
  }
  return result;
}
function extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes) {
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}
async function extractTransactions(page, tableLocator, transactionStatus) {
  const txns = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const transactionsRows = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr`, [], trs => {
    return trs.map(tr => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText)
    }));
  });
  for (const txnRow of transactionsRows) {
    extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes);
  }
  return txns;
}
async function isNoTransactionInDateRangeError(page) {
  const hasErrorInfoElement = await (0, _elementsInteractions.elementPresentOnPage)(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, errorElement => {
      return errorElement.innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}
async function searchByDates(page, startDate) {
  await (0, _elementsInteractions.clickButton)(page, 'a#tabHeader4');
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'div#fibi_dates');
  await (0, _elementsInteractions.fillInput)(page, 'input#fromDate', startDate.format(DATE_FORMAT));
  await (0, _elementsInteractions.clickButton)(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await (0, _elementsInteractions.clickButton)(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await (0, _navigation.waitForNavigation)(page);
}
async function getAccountNumber(page) {
  // Wait until the account number element is present in the DOM
  await (0, _elementsInteractions.waitUntilElementFound)(page, ACCOUNTS_NUMBER, true, ELEMENT_RENDER_TIMEOUT_MS);
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, option => {
    return option.innerText;
  });
  return selectedSnifAccount.replace('/', '_').trim();
}
async function checkIfHasNextPage(page) {
  return (0, _elementsInteractions.elementPresentOnPage)(page, NEXT_PAGE_LINK);
}
async function navigateToNextPage(page) {
  await (0, _elementsInteractions.clickButton)(page, NEXT_PAGE_LINK);
  await (0, _navigation.waitForNavigation)(page);
}

/* Couldn't reproduce scenario with multiple pages of pending transactions - Should support if exists such case.
   needToPaginate is false if scraping pending transactions */
async function scrapeTransactions(page, tableLocator, transactionStatus, needToPaginate, options) {
  const txns = [];
  let hasNextPage = false;
  do {
    const currentPageTxns = await extractTransactions(page, tableLocator, transactionStatus);
    txns.push(...currentPageTxns);
    if (needToPaginate) {
      hasNextPage = await checkIfHasNextPage(page);
      if (hasNextPage) {
        await navigateToNextPage(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns, options);
}
async function getAccountTransactions(page, options) {
  await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, "div[id*='divTable']", false), (0, _elementsInteractions.waitUntilElementFound)(page, `.${ERROR_MESSAGE_CLASS}`, false)]);
  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }
  const pendingTxns = await scrapeTransactions(page, PENDING_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Pending, false, options);
  const completedTxns = await scrapeTransactions(page, COMPLETED_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Completed, true, options);
  const txns = [...pendingTxns, ...completedTxns];
  return txns;
}
async function getCurrentBalance(page) {
  // Wait for the balance element to appear and be visible
  await (0, _elementsInteractions.waitUntilElementFound)(page, CURRENT_BALANCE, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Extract text content
  const balanceStr = await page.$eval(CURRENT_BALANCE, el => {
    return el.innerText;
  });
  return getAmountData(balanceStr);
}
async function waitForPostLogin(page) {
  return Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true),
  // Old UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true) // Old UI
  ]);
}
async function fetchAccountData(page, startDate, options) {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);
  return {
    accountNumber,
    txns,
    balance
  };
}
async function getAccountIdsOldUI(page) {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    if (!options) return [];
    return Array.from(options, option => option.value);
  });
}

/**
 * Ensures the account dropdown is open, then returns the available account labels.
 *
 * This method:
 * - Checks if the dropdown is already open.
 * - If not open, clicks the account selector to open it.
 * - Waits for the dropdown to render.
 * - Extracts and returns the list of available account labels.
 *
 * Graceful handling:
 * - If any error occurs (e.g., selectors not found, timing issues, UI version changes),
 *   the function returns an empty list.
 *
 * @param page Puppeteer Page object.
 * @returns An array of available account labels (e.g., ["127 | XXXX1", "127 | XXXX2"]),
 *          or an empty array if something goes wrong.
 */
async function clickAccountSelectorGetAccountIds(page) {
  try {
    const accountSelector = 'div.current-account'; // Direct selector to clickable element
    const dropdownPanelSelector = 'div.mat-mdc-autocomplete-panel.account-select-dd'; // The dropdown list box
    const optionSelector = 'mat-option .mdc-list-item__primary-text'; // Account option labels

    // Check if dropdown is already open
    const dropdownVisible = await page.$eval(dropdownPanelSelector, el => {
      return el && window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    }).catch(() => false); // catch if dropdown is not in the DOM yet

    if (!dropdownVisible) {
      await (0, _elementsInteractions.waitUntilElementFound)(page, accountSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

      // Click the account selector to open the dropdown
      await (0, _elementsInteractions.clickButton)(page, accountSelector);

      // Wait for the dropdown to open
      await (0, _elementsInteractions.waitUntilElementFound)(page, dropdownPanelSelector, true, ELEMENT_RENDER_TIMEOUT_MS);
    }

    // Extract account labels from the dropdown options
    const accountLabels = await page.$$eval(optionSelector, options => {
      return options.map(option => option.textContent?.trim() || '').filter(label => label !== '');
    });
    return accountLabels;
  } catch (error) {
    return []; // Graceful fallback
  }
}
async function getAccountIdsBothUIs(page) {
  let accountsIds = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) {
    accountsIds = await getAccountIdsOldUI(page);
  }
  return accountsIds;
}

/**
 * Selects an account from the dropdown based on the provided account label.
 *
 * This method:
 * - Clicks the account selector button to open the dropdown.
 * - Retrieves the list of available account labels.
 * - Checks if the provided account label exists in the list.
 * - Finds and clicks the matching account option if found.
 *
 * @param page Puppeteer Page object.
 * @param accountLabel The text of the account to select (e.g., "127 | XXXXX").
 * @returns True if the account option was found and clicked; false otherwise.
 */
async function selectAccountFromDropdown(page, accountLabel) {
  // Call clickAccountSelector to get the available accounts and open the dropdown
  const availableAccounts = await clickAccountSelectorGetAccountIds(page);

  // Check if the account label exists in the available accounts
  if (!availableAccounts.includes(accountLabel)) {
    return false;
  }

  // Wait for the dropdown options to be rendered
  const optionSelector = 'mat-option .mdc-list-item__primary-text';
  await (0, _elementsInteractions.waitUntilElementFound)(page, optionSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Query all matching options
  const accountOptions = await page.$$(optionSelector);

  // Find and click the option matching the accountLabel
  for (const option of accountOptions) {
    const text = await page.evaluate(el => el.textContent?.trim(), option);
    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el);
      await page.evaluate(el => el.click(), optionHandle);
      return true;
    }
  }
  return false;
}
async function getTransactionsFrame(page) {
  // Try a few times to find the iframe, as it might not be immediately available
  for (let attempt = 0; attempt < 3; attempt++) {
    await (0, _waiting.sleep)(2000);
    const frames = page.frames();
    const targetFrame = frames.find(f => f.name() === IFRAME_NAME);
    if (targetFrame) {
      return targetFrame;
    }
  }
  return null;
}
async function selectAccountBothUIs(page, accountId) {
  const accountSelected = await selectAccountFromDropdown(page, accountId);
  if (!accountSelected) {
    // Old UI format
    await page.select('#account_num_select', accountId);
    await (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num_select', true);
  }
}
async function fetchAccountDataBothUIs(page, startDate, options) {
  // Try to get the iframe for the new UI
  const frame = await getTransactionsFrame(page);

  // Use the frame if available (new UI), otherwise use the page directly (old UI)
  const targetPage = frame || page;
  return fetchAccountData(targetPage, startDate, options);
}
async function fetchAccounts(page, startDate, options) {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) {
    // In case accountsIds could no be parsed just return the transactions of the currently selected account
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    return [accountData];
  }
  const accounts = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    accounts.push(accountData);
  }
  return accounts;
}
class BeinleumiGroupBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  BASE_URL = '';
  LOGIN_URL = '';
  TRANSACTIONS_URL = '';
  getLoginOptions(credentials) {
    return {
      loginUrl: `${this.LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
      // HACK: For some reason, though the login button (#continueBtn) is present and visible, the click action does not perform.
      // Adding this delay fixes the issue.
      preAction: async () => {
        await (0, _waiting.sleep)(1000);
      }
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').add(1, 'day');
    const startMomentLimit = (0, _moment.default)({
      year: 1600
    });
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(startMomentLimit, (0, _moment.default)(startDate));
    await this.navigateTo(this.TRANSACTIONS_URL);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = BeinleumiGroupBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX3dhaXRpbmciLCJfdHJhbnNhY3Rpb25zMiIsIl9iYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiREFURV9GT1JNQVQiLCJOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQiLCJEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyIsIkRFQklUX0NPTFVNTl9DTEFTUyIsIkNSRURJVF9DT0xVTU5fQ0xBU1MiLCJFUlJPUl9NRVNTQUdFX0NMQVNTIiwiQUNDT1VOVFNfTlVNQkVSIiwiQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyIsIlNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSIsIkNPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUiLCJQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSIsIk5FWFRfUEFHRV9MSU5LIiwiQ1VSUkVOVF9CQUxBTkNFIiwiSUZSQU1FX05BTUUiLCJFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJ1cmxzIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIkludmFsaWRQYXNzd29yZCIsImNyZWF0ZUxvZ2luRmllbGRzIiwiY3JlZGVudGlhbHMiLCJzZWxlY3RvciIsInZhbHVlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImdldEFtb3VudERhdGEiLCJhbW91bnRTdHIiLCJhbW91bnRTdHJDb3B5IiwicmVwbGFjZSIsIlNIRUtFTF9DVVJSRU5DWV9TWU1CT0wiLCJyZXBsYWNlQWxsIiwicGFyc2VGbG9hdCIsImdldFR4bkFtb3VudCIsInR4biIsImNyZWRpdCIsImRlYml0IiwiTnVtYmVyIiwiaXNOYU4iLCJjb252ZXJ0VHJhbnNhY3Rpb25zIiwidHhucyIsIm9wdGlvbnMiLCJtYXAiLCJjb252ZXJ0ZWREYXRlIiwibW9tZW50IiwiZGF0ZSIsInRvSVNPU3RyaW5nIiwiY29udmVydGVkQW1vdW50IiwicmVzdWx0IiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJpZGVudGlmaWVyIiwicmVmZXJlbmNlIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJwcm9jZXNzZWREYXRlIiwib3JpZ2luYWxBbW91bnQiLCJvcmlnaW5hbEN1cnJlbmN5IiwiU0hFS0VMX0NVUlJFTkNZIiwiY2hhcmdlZEFtb3VudCIsInN0YXR1cyIsImRlc2NyaXB0aW9uIiwibWVtbyIsImluY2x1ZGVSYXdUcmFuc2FjdGlvbiIsInJhd1RyYW5zYWN0aW9uIiwiZ2V0UmF3VHJhbnNhY3Rpb24iLCJnZXRUcmFuc2FjdGlvbkRhdGUiLCJ0ZHMiLCJ0cmFuc2FjdGlvblR5cGUiLCJ0cmFuc2FjdGlvbnNDb2xzVHlwZXMiLCJ0cmltIiwiZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbiIsImdldFRyYW5zYWN0aW9uUmVmZXJlbmNlIiwiZ2V0VHJhbnNhY3Rpb25EZWJpdCIsImdldFRyYW5zYWN0aW9uQ3JlZGl0IiwiZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyIsInR4blJvdyIsInRyYW5zYWN0aW9uU3RhdHVzIiwiaW5uZXJUZHMiLCJpdGVtIiwiZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzIiwicGFnZSIsInRhYmxlTG9jYXRvciIsInR5cGVDbGFzc2VzT2JqcyIsInBhZ2VFdmFsQWxsIiwidGQiLCJpbmRleCIsImNvbENsYXNzIiwiZ2V0QXR0cmlidXRlIiwidHlwZUNsYXNzT2JqIiwiZXh0cmFjdFRyYW5zYWN0aW9uIiwicHVzaCIsImV4dHJhY3RUcmFuc2FjdGlvbnMiLCJ0cmFuc2FjdGlvbnNSb3dzIiwidHJzIiwidHIiLCJBcnJheSIsImZyb20iLCJnZXRFbGVtZW50c0J5VGFnTmFtZSIsImlubmVyVGV4dCIsImlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IiLCJoYXNFcnJvckluZm9FbGVtZW50IiwiZWxlbWVudFByZXNlbnRPblBhZ2UiLCJlcnJvclRleHQiLCIkZXZhbCIsImVycm9yRWxlbWVudCIsInNlYXJjaEJ5RGF0ZXMiLCJzdGFydERhdGUiLCJjbGlja0J1dHRvbiIsIndhaXRVbnRpbEVsZW1lbnRGb3VuZCIsImZpbGxJbnB1dCIsImZvcm1hdCIsIndhaXRGb3JOYXZpZ2F0aW9uIiwiZ2V0QWNjb3VudE51bWJlciIsInNlbGVjdGVkU25pZkFjY291bnQiLCJvcHRpb24iLCJjaGVja0lmSGFzTmV4dFBhZ2UiLCJuYXZpZ2F0ZVRvTmV4dFBhZ2UiLCJzY3JhcGVUcmFuc2FjdGlvbnMiLCJuZWVkVG9QYWdpbmF0ZSIsImhhc05leHRQYWdlIiwiY3VycmVudFBhZ2VUeG5zIiwiZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyIsIlByb21pc2UiLCJyYWNlIiwibm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvciIsInBlbmRpbmdUeG5zIiwiVHJhbnNhY3Rpb25TdGF0dXNlcyIsIlBlbmRpbmciLCJjb21wbGV0ZWRUeG5zIiwiQ29tcGxldGVkIiwiZ2V0Q3VycmVudEJhbGFuY2UiLCJiYWxhbmNlU3RyIiwiZWwiLCJ3YWl0Rm9yUG9zdExvZ2luIiwiZmV0Y2hBY2NvdW50RGF0YSIsImFjY291bnROdW1iZXIiLCJiYWxhbmNlIiwiZ2V0QWNjb3VudElkc09sZFVJIiwiZXZhbHVhdGUiLCJzZWxlY3RFbGVtZW50IiwiZG9jdW1lbnQiLCJnZXRFbGVtZW50QnlJZCIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMiLCJhY2NvdW50U2VsZWN0b3IiLCJkcm9wZG93blBhbmVsU2VsZWN0b3IiLCJvcHRpb25TZWxlY3RvciIsImRyb3Bkb3duVmlzaWJsZSIsIndpbmRvdyIsImdldENvbXB1dGVkU3R5bGUiLCJkaXNwbGF5Iiwib2Zmc2V0UGFyZW50IiwiY2F0Y2giLCJhY2NvdW50TGFiZWxzIiwiJCRldmFsIiwidGV4dENvbnRlbnQiLCJmaWx0ZXIiLCJsYWJlbCIsImVycm9yIiwiZ2V0QWNjb3VudElkc0JvdGhVSXMiLCJhY2NvdW50c0lkcyIsImxlbmd0aCIsInNlbGVjdEFjY291bnRGcm9tRHJvcGRvd24iLCJhY2NvdW50TGFiZWwiLCJhdmFpbGFibGVBY2NvdW50cyIsImluY2x1ZGVzIiwiYWNjb3VudE9wdGlvbnMiLCIkJCIsInRleHQiLCJvcHRpb25IYW5kbGUiLCJldmFsdWF0ZUhhbmRsZSIsImNsaWNrIiwiZ2V0VHJhbnNhY3Rpb25zRnJhbWUiLCJhdHRlbXB0Iiwic2xlZXAiLCJmcmFtZXMiLCJ0YXJnZXRGcmFtZSIsImZpbmQiLCJmIiwibmFtZSIsInNlbGVjdEFjY291bnRCb3RoVUlzIiwiYWNjb3VudElkIiwiYWNjb3VudFNlbGVjdGVkIiwic2VsZWN0IiwiZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMiLCJmcmFtZSIsInRhcmdldFBhZ2UiLCJmZXRjaEFjY291bnRzIiwiYWNjb3VudERhdGEiLCJhY2NvdW50cyIsIkJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJUUkFOU0FDVElPTlNfVVJMIiwiZ2V0TG9naW5PcHRpb25zIiwibG9naW5VcmwiLCJmaWVsZHMiLCJzdWJtaXRCdXR0b25TZWxlY3RvciIsInBvc3RBY3Rpb24iLCJwb3NzaWJsZVJlc3VsdHMiLCJwcmVBY3Rpb24iLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsImFkZCIsInN0YXJ0TW9tZW50TGltaXQiLCJ5ZWFyIiwidG9EYXRlIiwic3RhcnRNb21lbnQiLCJtYXgiLCJuYXZpZ2F0ZVRvIiwic3VjY2VzcyIsIl9kZWZhdWx0IiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9iYXNlLWJlaW5sZXVtaS1ncm91cC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbW9tZW50LCB7IHR5cGUgTW9tZW50IH0gZnJvbSAnbW9tZW50JztcclxuaW1wb3J0IHsgdHlwZSBGcmFtZSwgdHlwZSBQYWdlIH0gZnJvbSAncHVwcGV0ZWVyJztcclxuaW1wb3J0IHsgU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MIH0gZnJvbSAnLi4vY29uc3RhbnRzJztcclxuaW1wb3J0IHtcclxuICBjbGlja0J1dHRvbixcclxuICBlbGVtZW50UHJlc2VudE9uUGFnZSxcclxuICBmaWxsSW5wdXQsXHJcbiAgcGFnZUV2YWxBbGwsXHJcbiAgd2FpdFVudGlsRWxlbWVudEZvdW5kLFxyXG59IGZyb20gJy4uL2hlbHBlcnMvZWxlbWVudHMtaW50ZXJhY3Rpb25zJztcclxuaW1wb3J0IHsgd2FpdEZvck5hdmlnYXRpb24gfSBmcm9tICcuLi9oZWxwZXJzL25hdmlnYXRpb24nO1xyXG5pbXBvcnQgeyBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcclxuaW1wb3J0IHsgc2xlZXAgfSBmcm9tICcuLi9oZWxwZXJzL3dhaXRpbmcnO1xyXG5pbXBvcnQgeyBUcmFuc2FjdGlvblN0YXR1c2VzLCBUcmFuc2FjdGlvblR5cGVzLCB0eXBlIFRyYW5zYWN0aW9uLCB0eXBlIFRyYW5zYWN0aW9uc0FjY291bnQgfSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xyXG5pbXBvcnQgeyBCYXNlU2NyYXBlcldpdGhCcm93c2VyLCBMb2dpblJlc3VsdHMsIHR5cGUgUG9zc2libGVMb2dpblJlc3VsdHMgfSBmcm9tICcuL2Jhc2Utc2NyYXBlci13aXRoLWJyb3dzZXInO1xyXG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJPcHRpb25zIH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xyXG5cclxuY29uc3QgREFURV9GT1JNQVQgPSAnREQvTU0vWVlZWSc7XHJcbmNvbnN0IE5PX1RSQU5TQUNUSU9OX0lOX0RBVEVfUkFOR0VfVEVYVCA9ICfXnNeQINeg157XpteQ15Ug16DXqteV16DXmdedINeR16DXldep15Ag15TXnteR15XXp9epJztcclxuY29uc3QgREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEID0gJ2RhdGUgZmlyc3QnO1xyXG5jb25zdCBEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HID0gJ2ZpcnN0IGRhdGUnO1xyXG5jb25zdCBERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEID0gJ3JlZmVyZW5jZSB3cmFwX25vcm1hbCc7XHJcbmNvbnN0IERFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HID0gJ2RldGFpbHMgd3JhcF9ub3JtYWwnO1xyXG5jb25zdCBSRUZFUkVOQ0VfQ09MVU1OX0NMQVNTID0gJ2RldGFpbHMnO1xyXG5jb25zdCBERUJJVF9DT0xVTU5fQ0xBU1MgPSAnZGViaXQnO1xyXG5jb25zdCBDUkVESVRfQ09MVU1OX0NMQVNTID0gJ2NyZWRpdCc7XHJcbmNvbnN0IEVSUk9SX01FU1NBR0VfQ0xBU1MgPSAnTk9fREFUQSc7XHJcbmNvbnN0IEFDQ09VTlRTX05VTUJFUiA9ICdkaXYuZmliaV9hY2NvdW50IHNwYW4uYWNjX251bSc7XHJcbmNvbnN0IENMT1NFX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fQ0xBU1MgPSAndWktZGF0ZXBpY2tlci1jbG9zZSc7XHJcbmNvbnN0IFNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSA9ICfXlNem15InO1xyXG5jb25zdCBDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFID0gJ3RhYmxlI2RhdGFUYWJsZTA3Nyc7XHJcbmNvbnN0IFBFTkRJTkdfVFJBTlNBQ1RJT05TX1RBQkxFID0gJ3RhYmxlI2RhdGFUYWJsZTAyMyc7XHJcbmNvbnN0IE5FWFRfUEFHRV9MSU5LID0gJ2EjTnBhZ2UucGFnaW5nJztcclxuY29uc3QgQ1VSUkVOVF9CQUxBTkNFID0gJy5tYWluX2JhbGFuY2UnO1xyXG5jb25zdCBJRlJBTUVfTkFNRSA9ICdpZnJhbWUtb2xkLXBhZ2VzJztcclxuY29uc3QgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyA9IDEwMDAwO1xyXG5cclxudHlwZSBUcmFuc2FjdGlvbnNDb2xzVHlwZXMgPSBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xyXG50eXBlIFRyYW5zYWN0aW9uc1RyVGRzID0gc3RyaW5nW107XHJcbnR5cGUgVHJhbnNhY3Rpb25zVHIgPSB7IGlubmVyVGRzOiBUcmFuc2FjdGlvbnNUclRkcyB9O1xyXG5cclxuaW50ZXJmYWNlIFNjcmFwZWRUcmFuc2FjdGlvbiB7XHJcbiAgcmVmZXJlbmNlOiBzdHJpbmc7XHJcbiAgZGF0ZTogc3RyaW5nO1xyXG4gIGNyZWRpdDogc3RyaW5nO1xyXG4gIGRlYml0OiBzdHJpbmc7XHJcbiAgbWVtbz86IHN0cmluZztcclxuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xyXG4gIHN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcztcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCk6IFBvc3NpYmxlTG9naW5SZXN1bHRzIHtcclxuICBjb25zdCB1cmxzOiBQb3NzaWJsZUxvZ2luUmVzdWx0cyA9IHt9O1xyXG4gIHVybHNbTG9naW5SZXN1bHRzLlN1Y2Nlc3NdID0gW1xyXG4gICAgL2ZpYmkuKmFjY291bnRTdW1tYXJ5LywgLy8gTmV3IFVJIHBhdHRlcm5cclxuICAgIC9SZXNvdXJjZXNcXC9Qb3J0YWxOR1xcL3NoZWxsLywgLy8gTmV3IFVJIHBhdHRlcm5cclxuICAgIC9GaWJpTWVudVxcL09ubGluZS8sIC8vIE9sZCBVSSBwYXR0ZXJuXHJcbiAgXTtcclxuICB1cmxzW0xvZ2luUmVzdWx0cy5JbnZhbGlkUGFzc3dvcmRdID0gWy9GaWJpTWVudVxcL01hcmtldGluZ1xcL1ByaXZhdGVcXC9Ib21lL107XHJcbiAgcmV0dXJuIHVybHM7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcclxuICByZXR1cm4gW1xyXG4gICAgeyBzZWxlY3RvcjogJyN1c2VybmFtZScsIHZhbHVlOiBjcmVkZW50aWFscy51c2VybmFtZSB9LFxyXG4gICAgeyBzZWxlY3RvcjogJyNwYXNzd29yZCcsIHZhbHVlOiBjcmVkZW50aWFscy5wYXNzd29yZCB9LFxyXG4gIF07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldEFtb3VudERhdGEoYW1vdW50U3RyOiBzdHJpbmcpIHtcclxuICBsZXQgYW1vdW50U3RyQ29weSA9IGFtb3VudFN0ci5yZXBsYWNlKFNIRUtFTF9DVVJSRU5DWV9TWU1CT0wsICcnKTtcclxuICBhbW91bnRTdHJDb3B5ID0gYW1vdW50U3RyQ29weS5yZXBsYWNlQWxsKCcsJywgJycpO1xyXG4gIHJldHVybiBwYXJzZUZsb2F0KGFtb3VudFN0ckNvcHkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRUeG5BbW91bnQodHhuOiBTY3JhcGVkVHJhbnNhY3Rpb24pIHtcclxuICBjb25zdCBjcmVkaXQgPSBnZXRBbW91bnREYXRhKHR4bi5jcmVkaXQpO1xyXG4gIGNvbnN0IGRlYml0ID0gZ2V0QW1vdW50RGF0YSh0eG4uZGViaXQpO1xyXG4gIHJldHVybiAoTnVtYmVyLmlzTmFOKGNyZWRpdCkgPyAwIDogY3JlZGl0KSAtIChOdW1iZXIuaXNOYU4oZGViaXQpID8gMCA6IGRlYml0KTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29udmVydFRyYW5zYWN0aW9ucyh0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogVHJhbnNhY3Rpb25bXSB7XHJcbiAgcmV0dXJuIHR4bnMubWFwKCh0eG4pOiBUcmFuc2FjdGlvbiA9PiB7XHJcbiAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbW9tZW50KHR4bi5kYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IGNvbnZlcnRlZEFtb3VudCA9IGdldFR4bkFtb3VudCh0eG4pO1xyXG4gICAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbiA9IHtcclxuICAgICAgdHlwZTogVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWwsXHJcbiAgICAgIGlkZW50aWZpZXI6IHR4bi5yZWZlcmVuY2UgPyBwYXJzZUludCh0eG4ucmVmZXJlbmNlLCAxMCkgOiB1bmRlZmluZWQsXHJcbiAgICAgIGRhdGU6IGNvbnZlcnRlZERhdGUsXHJcbiAgICAgIHByb2Nlc3NlZERhdGU6IGNvbnZlcnRlZERhdGUsXHJcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXHJcbiAgICAgIG9yaWdpbmFsQ3VycmVuY3k6IFNIRUtFTF9DVVJSRU5DWSxcclxuICAgICAgY2hhcmdlZEFtb3VudDogY29udmVydGVkQW1vdW50LFxyXG4gICAgICBzdGF0dXM6IHR4bi5zdGF0dXMsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiB0eG4uZGVzY3JpcHRpb24sXHJcbiAgICAgIG1lbW86IHR4bi5tZW1vLFxyXG4gICAgfTtcclxuXHJcbiAgICBpZiAob3B0aW9ucz8uaW5jbHVkZVJhd1RyYW5zYWN0aW9uKSB7XHJcbiAgICAgIHJlc3VsdC5yYXdUcmFuc2FjdGlvbiA9IGdldFJhd1RyYW5zYWN0aW9uKHR4bik7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25EYXRlKFxyXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXHJcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXHJcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXHJcbikge1xyXG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XHJcbiAgICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREFURV9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEXV0gfHwgJycpLnRyaW0oKTtcclxuICB9XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RBVEVfQ09MVU1OX0NMQVNTX1BFTkRJTkddXSB8fCAnJykudHJpbSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uKFxyXG4gIHRkczogVHJhbnNhY3Rpb25zVHJUZHMsXHJcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXHJcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXHJcbikge1xyXG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XHJcbiAgICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRF1dIHx8ICcnKS50cmltKCk7XHJcbiAgfVxyXG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElOR11dIHx8ICcnKS50cmltKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uUmVmZXJlbmNlKHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW1JFRkVSRU5DRV9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlYml0KHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFQklUX0NPTFVNTl9DTEFTU11dIHx8ICcnKS50cmltKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uQ3JlZGl0KHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XHJcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0NSRURJVF9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb25EZXRhaWxzKFxyXG4gIHR4blJvdzogVHJhbnNhY3Rpb25zVHIsXHJcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXHJcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXHJcbik6IFNjcmFwZWRUcmFuc2FjdGlvbiB7XHJcbiAgY29uc3QgdGRzID0gdHhuUm93LmlubmVyVGRzO1xyXG4gIGNvbnN0IGl0ZW0gPSB7XHJcbiAgICBzdGF0dXM6IHRyYW5zYWN0aW9uU3RhdHVzLFxyXG4gICAgZGF0ZTogZ2V0VHJhbnNhY3Rpb25EYXRlKHRkcywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXHJcbiAgICBkZXNjcmlwdGlvbjogZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbih0ZHMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxyXG4gICAgcmVmZXJlbmNlOiBnZXRUcmFuc2FjdGlvblJlZmVyZW5jZSh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXHJcbiAgICBkZWJpdDogZ2V0VHJhbnNhY3Rpb25EZWJpdCh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXHJcbiAgICBjcmVkaXQ6IGdldFRyYW5zYWN0aW9uQ3JlZGl0KHRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKSxcclxuICB9O1xyXG5cclxuICByZXR1cm4gaXRlbTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKFxyXG4gIHBhZ2U6IFBhZ2UgfCBGcmFtZSxcclxuICB0YWJsZUxvY2F0b3I6IHN0cmluZyxcclxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNDb2xzVHlwZXM+IHtcclxuICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IHt9O1xyXG4gIGNvbnN0IHR5cGVDbGFzc2VzT2JqcyA9IGF3YWl0IHBhZ2VFdmFsQWxsKHBhZ2UsIGAke3RhYmxlTG9jYXRvcn0gdGJvZHkgdHI6Zmlyc3Qtb2YtdHlwZSB0ZGAsIG51bGwsIHRkcyA9PiB7XHJcbiAgICByZXR1cm4gdGRzLm1hcCgodGQsIGluZGV4KSA9PiAoe1xyXG4gICAgICBjb2xDbGFzczogdGQuZ2V0QXR0cmlidXRlKCdjbGFzcycpLFxyXG4gICAgICBpbmRleCxcclxuICAgIH0pKTtcclxuICB9KTtcclxuXHJcbiAgZm9yIChjb25zdCB0eXBlQ2xhc3NPYmogb2YgdHlwZUNsYXNzZXNPYmpzKSB7XHJcbiAgICBpZiAodHlwZUNsYXNzT2JqLmNvbENsYXNzKSB7XHJcbiAgICAgIHJlc3VsdFt0eXBlQ2xhc3NPYmouY29sQ2xhc3NdID0gdHlwZUNsYXNzT2JqLmluZGV4O1xyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBleHRyYWN0VHJhbnNhY3Rpb24oXHJcbiAgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sXHJcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXHJcbiAgdHhuUm93OiBUcmFuc2FjdGlvbnNUcixcclxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcclxuKSB7XHJcbiAgY29uc3QgdHhuID0gZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyh0eG5Sb3csIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpO1xyXG4gIGlmICh0eG4uZGF0ZSAhPT0gJycpIHtcclxuICAgIHR4bnMucHVzaCh0eG4pO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlIHwgRnJhbWUsIHRhYmxlTG9jYXRvcjogc3RyaW5nLCB0cmFuc2FjdGlvblN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcykge1xyXG4gIGNvbnN0IHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdID0gW107XHJcbiAgY29uc3QgdHJhbnNhY3Rpb25zQ29sc1R5cGVzID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKHBhZ2UsIHRhYmxlTG9jYXRvcik7XHJcblxyXG4gIGNvbnN0IHRyYW5zYWN0aW9uc1Jvd3MgPSBhd2FpdCBwYWdlRXZhbEFsbDxUcmFuc2FjdGlvbnNUcltdPihwYWdlLCBgJHt0YWJsZUxvY2F0b3J9IHRib2R5IHRyYCwgW10sIHRycyA9PiB7XHJcbiAgICByZXR1cm4gdHJzLm1hcCh0ciA9PiAoe1xyXG4gICAgICBpbm5lclRkczogQXJyYXkuZnJvbSh0ci5nZXRFbGVtZW50c0J5VGFnTmFtZSgndGQnKSkubWFwKHRkID0+IHRkLmlubmVyVGV4dCksXHJcbiAgICB9KSk7XHJcbiAgfSk7XHJcblxyXG4gIGZvciAoY29uc3QgdHhuUm93IG9mIHRyYW5zYWN0aW9uc1Jvd3MpIHtcclxuICAgIGV4dHJhY3RUcmFuc2FjdGlvbih0eG5zLCB0cmFuc2FjdGlvblN0YXR1cywgdHhuUm93LCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpO1xyXG4gIH1cclxuICByZXR1cm4gdHhucztcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlOiBQYWdlIHwgRnJhbWUpIHtcclxuICBjb25zdCBoYXNFcnJvckluZm9FbGVtZW50ID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCk7XHJcbiAgaWYgKGhhc0Vycm9ySW5mb0VsZW1lbnQpIHtcclxuICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHBhZ2UuJGV2YWwoYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZXJyb3JFbGVtZW50ID0+IHtcclxuICAgICAgcmV0dXJuIChlcnJvckVsZW1lbnQgYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcclxuICAgIH0pO1xyXG4gICAgcmV0dXJuIGVycm9yVGV4dC50cmltKCkgPT09IE5PX1RSQU5TQUNUSU9OX0lOX0RBVEVfUkFOR0VfVEVYVDtcclxuICB9XHJcbiAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzZWFyY2hCeURhdGVzKHBhZ2U6IFBhZ2UgfCBGcmFtZSwgc3RhcnREYXRlOiBNb21lbnQpIHtcclxuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCAnYSN0YWJIZWFkZXI0Jyk7XHJcbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICdkaXYjZmliaV9kYXRlcycpO1xyXG4gIGF3YWl0IGZpbGxJbnB1dChwYWdlLCAnaW5wdXQjZnJvbURhdGUnLCBzdGFydERhdGUuZm9ybWF0KERBVEVfRk9STUFUKSk7XHJcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgYGJ1dHRvbltjbGFzcyo9JHtDTE9TRV9TRUFSQ0hfQllfREFURVNfQlVUVE9OX0NMQVNTfV1gKTtcclxuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBgaW5wdXRbdmFsdWU9JHtTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUV9XWApO1xyXG4gIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHBhZ2UpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50TnVtYmVyKHBhZ2U6IFBhZ2UgfCBGcmFtZSk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgLy8gV2FpdCB1bnRpbCB0aGUgYWNjb3VudCBudW1iZXIgZWxlbWVudCBpcyBwcmVzZW50IGluIHRoZSBET01cclxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQUNDT1VOVFNfTlVNQkVSLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcclxuXHJcbiAgY29uc3Qgc2VsZWN0ZWRTbmlmQWNjb3VudCA9IGF3YWl0IHBhZ2UuJGV2YWwoQUNDT1VOVFNfTlVNQkVSLCBvcHRpb24gPT4ge1xyXG4gICAgcmV0dXJuIChvcHRpb24gYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIHNlbGVjdGVkU25pZkFjY291bnQucmVwbGFjZSgnLycsICdfJykudHJpbSgpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjaGVja0lmSGFzTmV4dFBhZ2UocGFnZTogUGFnZSB8IEZyYW1lKSB7XHJcbiAgcmV0dXJuIGVsZW1lbnRQcmVzZW50T25QYWdlKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gbmF2aWdhdGVUb05leHRQYWdlKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xyXG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsIE5FWFRfUEFHRV9MSU5LKTtcclxuICBhd2FpdCB3YWl0Rm9yTmF2aWdhdGlvbihwYWdlKTtcclxufVxyXG5cclxuLyogQ291bGRuJ3QgcmVwcm9kdWNlIHNjZW5hcmlvIHdpdGggbXVsdGlwbGUgcGFnZXMgb2YgcGVuZGluZyB0cmFuc2FjdGlvbnMgLSBTaG91bGQgc3VwcG9ydCBpZiBleGlzdHMgc3VjaCBjYXNlLlxyXG4gICBuZWVkVG9QYWdpbmF0ZSBpcyBmYWxzZSBpZiBzY3JhcGluZyBwZW5kaW5nIHRyYW5zYWN0aW9ucyAqL1xyXG5hc3luYyBmdW5jdGlvbiBzY3JhcGVUcmFuc2FjdGlvbnMoXHJcbiAgcGFnZTogUGFnZSB8IEZyYW1lLFxyXG4gIHRhYmxlTG9jYXRvcjogc3RyaW5nLFxyXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxyXG4gIG5lZWRUb1BhZ2luYXRlOiBib29sZWFuLFxyXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcclxuKSB7XHJcbiAgY29uc3QgdHhucyA9IFtdO1xyXG4gIGxldCBoYXNOZXh0UGFnZSA9IGZhbHNlO1xyXG5cclxuICBkbyB7XHJcbiAgICBjb25zdCBjdXJyZW50UGFnZVR4bnMgPSBhd2FpdCBleHRyYWN0VHJhbnNhY3Rpb25zKHBhZ2UsIHRhYmxlTG9jYXRvciwgdHJhbnNhY3Rpb25TdGF0dXMpO1xyXG4gICAgdHhucy5wdXNoKC4uLmN1cnJlbnRQYWdlVHhucyk7XHJcbiAgICBpZiAobmVlZFRvUGFnaW5hdGUpIHtcclxuICAgICAgaGFzTmV4dFBhZ2UgPSBhd2FpdCBjaGVja0lmSGFzTmV4dFBhZ2UocGFnZSk7XHJcbiAgICAgIGlmIChoYXNOZXh0UGFnZSkge1xyXG4gICAgICAgIGF3YWl0IG5hdmlnYXRlVG9OZXh0UGFnZShwYWdlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH0gd2hpbGUgKGhhc05leHRQYWdlKTtcclxuXHJcbiAgcmV0dXJuIGNvbnZlcnRUcmFuc2FjdGlvbnModHhucywgb3B0aW9ucyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRUcmFuc2FjdGlvbnMocGFnZTogUGFnZSB8IEZyYW1lLCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpIHtcclxuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIFwiZGl2W2lkKj0nZGl2VGFibGUnXVwiLCBmYWxzZSksXHJcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCwgZmFsc2UpLFxyXG4gIF0pO1xyXG5cclxuICBjb25zdCBub1RyYW5zYWN0aW9uSW5SYW5nZUVycm9yID0gYXdhaXQgaXNOb1RyYW5zYWN0aW9uSW5EYXRlUmFuZ2VFcnJvcihwYWdlKTtcclxuICBpZiAobm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvcikge1xyXG4gICAgcmV0dXJuIFtdO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcGVuZGluZ1R4bnMgPSBhd2FpdCBzY3JhcGVUcmFuc2FjdGlvbnMoXHJcbiAgICBwYWdlLFxyXG4gICAgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUsXHJcbiAgICBUcmFuc2FjdGlvblN0YXR1c2VzLlBlbmRpbmcsXHJcbiAgICBmYWxzZSxcclxuICAgIG9wdGlvbnMsXHJcbiAgKTtcclxuICBjb25zdCBjb21wbGV0ZWRUeG5zID0gYXdhaXQgc2NyYXBlVHJhbnNhY3Rpb25zKFxyXG4gICAgcGFnZSxcclxuICAgIENPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUsXHJcbiAgICBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcclxuICAgIHRydWUsXHJcbiAgICBvcHRpb25zLFxyXG4gICk7XHJcbiAgY29uc3QgdHhucyA9IFsuLi5wZW5kaW5nVHhucywgLi4uY29tcGxldGVkVHhuc107XHJcbiAgcmV0dXJuIHR4bnM7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldEN1cnJlbnRCYWxhbmNlKHBhZ2U6IFBhZ2UgfCBGcmFtZSk6IFByb21pc2U8bnVtYmVyPiB7XHJcbiAgLy8gV2FpdCBmb3IgdGhlIGJhbGFuY2UgZWxlbWVudCB0byBhcHBlYXIgYW5kIGJlIHZpc2libGVcclxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQ1VSUkVOVF9CQUxBTkNFLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcclxuXHJcbiAgLy8gRXh0cmFjdCB0ZXh0IGNvbnRlbnRcclxuICBjb25zdCBiYWxhbmNlU3RyID0gYXdhaXQgcGFnZS4kZXZhbChDVVJSRU5UX0JBTEFOQ0UsIGVsID0+IHtcclxuICAgIHJldHVybiAoZWwgYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIGdldEFtb3VudERhdGEoYmFsYW5jZVN0cik7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yUG9zdExvZ2luKHBhZ2U6IFBhZ2UpIHtcclxuICByZXR1cm4gUHJvbWlzZS5yYWNlKFtcclxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2NhcmQtaGVhZGVyJywgZmFsc2UpLCAvLyBOZXcgVUlcclxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtJywgdHJ1ZSksIC8vIE5ldyBVSVxyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjbWF0YWZMb2dvdXRMaW5rJywgdHJ1ZSksIC8vIE9sZCBVSVxyXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjdmFsaWRhdGlvbk1zZycsIHRydWUpLCAvLyBPbGQgVUlcclxuICBdKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50RGF0YShwYWdlOiBQYWdlIHwgRnJhbWUsIHN0YXJ0RGF0ZTogTW9tZW50LCBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMpIHtcclxuICBjb25zdCBhY2NvdW50TnVtYmVyID0gYXdhaXQgZ2V0QWNjb3VudE51bWJlcihwYWdlKTtcclxuICBjb25zdCBiYWxhbmNlID0gYXdhaXQgZ2V0Q3VycmVudEJhbGFuY2UocGFnZSk7XHJcbiAgYXdhaXQgc2VhcmNoQnlEYXRlcyhwYWdlLCBzdGFydERhdGUpO1xyXG4gIGNvbnN0IHR4bnMgPSBhd2FpdCBnZXRBY2NvdW50VHJhbnNhY3Rpb25zKHBhZ2UsIG9wdGlvbnMpO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgYWNjb3VudE51bWJlcixcclxuICAgIHR4bnMsXHJcbiAgICBiYWxhbmNlLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRJZHNPbGRVSShwYWdlOiBQYWdlKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xyXG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKCgpID0+IHtcclxuICAgIGNvbnN0IHNlbGVjdEVsZW1lbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYWNjb3VudF9udW1fc2VsZWN0Jyk7XHJcbiAgICBjb25zdCBvcHRpb25zID0gc2VsZWN0RWxlbWVudCA/IHNlbGVjdEVsZW1lbnQucXVlcnlTZWxlY3RvckFsbCgnb3B0aW9uJykgOiBbXTtcclxuICAgIGlmICghb3B0aW9ucykgcmV0dXJuIFtdO1xyXG4gICAgcmV0dXJuIEFycmF5LmZyb20ob3B0aW9ucywgb3B0aW9uID0+IG9wdGlvbi52YWx1ZSk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFbnN1cmVzIHRoZSBhY2NvdW50IGRyb3Bkb3duIGlzIG9wZW4sIHRoZW4gcmV0dXJucyB0aGUgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxyXG4gKlxyXG4gKiBUaGlzIG1ldGhvZDpcclxuICogLSBDaGVja3MgaWYgdGhlIGRyb3Bkb3duIGlzIGFscmVhZHkgb3Blbi5cclxuICogLSBJZiBub3Qgb3BlbiwgY2xpY2tzIHRoZSBhY2NvdW50IHNlbGVjdG9yIHRvIG9wZW4gaXQuXHJcbiAqIC0gV2FpdHMgZm9yIHRoZSBkcm9wZG93biB0byByZW5kZXIuXHJcbiAqIC0gRXh0cmFjdHMgYW5kIHJldHVybnMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxyXG4gKlxyXG4gKiBHcmFjZWZ1bCBoYW5kbGluZzpcclxuICogLSBJZiBhbnkgZXJyb3Igb2NjdXJzIChlLmcuLCBzZWxlY3RvcnMgbm90IGZvdW5kLCB0aW1pbmcgaXNzdWVzLCBVSSB2ZXJzaW9uIGNoYW5nZXMpLFxyXG4gKiAgIHRoZSBmdW5jdGlvbiByZXR1cm5zIGFuIGVtcHR5IGxpc3QuXHJcbiAqXHJcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cclxuICogQHJldHVybnMgQW4gYXJyYXkgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzIChlLmcuLCBbXCIxMjcgfCBYWFhYMVwiLCBcIjEyNyB8IFhYWFgyXCJdKSxcclxuICogICAgICAgICAgb3IgYW4gZW1wdHkgYXJyYXkgaWYgc29tZXRoaW5nIGdvZXMgd3JvbmcuXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGFjY291bnRTZWxlY3RvciA9ICdkaXYuY3VycmVudC1hY2NvdW50JzsgLy8gRGlyZWN0IHNlbGVjdG9yIHRvIGNsaWNrYWJsZSBlbGVtZW50XHJcbiAgICBjb25zdCBkcm9wZG93blBhbmVsU2VsZWN0b3IgPSAnZGl2Lm1hdC1tZGMtYXV0b2NvbXBsZXRlLXBhbmVsLmFjY291bnQtc2VsZWN0LWRkJzsgLy8gVGhlIGRyb3Bkb3duIGxpc3QgYm94XHJcbiAgICBjb25zdCBvcHRpb25TZWxlY3RvciA9ICdtYXQtb3B0aW9uIC5tZGMtbGlzdC1pdGVtX19wcmltYXJ5LXRleHQnOyAvLyBBY2NvdW50IG9wdGlvbiBsYWJlbHNcclxuXHJcbiAgICAvLyBDaGVjayBpZiBkcm9wZG93biBpcyBhbHJlYWR5IG9wZW5cclxuICAgIGNvbnN0IGRyb3Bkb3duVmlzaWJsZSA9IGF3YWl0IHBhZ2VcclxuICAgICAgLiRldmFsKGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgZWwgPT4ge1xyXG4gICAgICAgIHJldHVybiBlbCAmJiB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbCkuZGlzcGxheSAhPT0gJ25vbmUnICYmIGVsLm9mZnNldFBhcmVudCAhPT0gbnVsbDtcclxuICAgICAgfSlcclxuICAgICAgLmNhdGNoKCgpID0+IGZhbHNlKTsgLy8gY2F0Y2ggaWYgZHJvcGRvd24gaXMgbm90IGluIHRoZSBET00geWV0XHJcblxyXG4gICAgaWYgKCFkcm9wZG93blZpc2libGUpIHtcclxuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGFjY291bnRTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XHJcblxyXG4gICAgICAvLyBDbGljayB0aGUgYWNjb3VudCBzZWxlY3RvciB0byBvcGVuIHRoZSBkcm9wZG93blxyXG4gICAgICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBhY2NvdW50U2VsZWN0b3IpO1xyXG5cclxuICAgICAgLy8gV2FpdCBmb3IgdGhlIGRyb3Bkb3duIHRvIG9wZW5cclxuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRXh0cmFjdCBhY2NvdW50IGxhYmVscyBmcm9tIHRoZSBkcm9wZG93biBvcHRpb25zXHJcbiAgICBjb25zdCBhY2NvdW50TGFiZWxzID0gYXdhaXQgcGFnZS4kJGV2YWwob3B0aW9uU2VsZWN0b3IsIG9wdGlvbnMgPT4ge1xyXG4gICAgICByZXR1cm4gb3B0aW9ucy5tYXAob3B0aW9uID0+IG9wdGlvbi50ZXh0Q29udGVudD8udHJpbSgpIHx8ICcnKS5maWx0ZXIobGFiZWwgPT4gbGFiZWwgIT09ICcnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBhY2NvdW50TGFiZWxzO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICByZXR1cm4gW107IC8vIEdyYWNlZnVsIGZhbGxiYWNrXHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRBY2NvdW50SWRzQm90aFVJcyhwYWdlOiBQYWdlKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xyXG4gIGxldCBhY2NvdW50c0lkczogc3RyaW5nW10gPSBhd2FpdCBjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMocGFnZSk7XHJcbiAgaWYgKGFjY291bnRzSWRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgYWNjb3VudHNJZHMgPSBhd2FpdCBnZXRBY2NvdW50SWRzT2xkVUkocGFnZSk7XHJcbiAgfVxyXG4gIHJldHVybiBhY2NvdW50c0lkcztcclxufVxyXG5cclxuLyoqXHJcbiAqIFNlbGVjdHMgYW4gYWNjb3VudCBmcm9tIHRoZSBkcm9wZG93biBiYXNlZCBvbiB0aGUgcHJvdmlkZWQgYWNjb3VudCBsYWJlbC5cclxuICpcclxuICogVGhpcyBtZXRob2Q6XHJcbiAqIC0gQ2xpY2tzIHRoZSBhY2NvdW50IHNlbGVjdG9yIGJ1dHRvbiB0byBvcGVuIHRoZSBkcm9wZG93bi5cclxuICogLSBSZXRyaWV2ZXMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxyXG4gKiAtIENoZWNrcyBpZiB0aGUgcHJvdmlkZWQgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGxpc3QuXHJcbiAqIC0gRmluZHMgYW5kIGNsaWNrcyB0aGUgbWF0Y2hpbmcgYWNjb3VudCBvcHRpb24gaWYgZm91bmQuXHJcbiAqXHJcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cclxuICogQHBhcmFtIGFjY291bnRMYWJlbCBUaGUgdGV4dCBvZiB0aGUgYWNjb3VudCB0byBzZWxlY3QgKGUuZy4sIFwiMTI3IHwgWFhYWFhcIikuXHJcbiAqIEByZXR1cm5zIFRydWUgaWYgdGhlIGFjY291bnQgb3B0aW9uIHdhcyBmb3VuZCBhbmQgY2xpY2tlZDsgZmFsc2Ugb3RoZXJ3aXNlLlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNlbGVjdEFjY291bnRGcm9tRHJvcGRvd24ocGFnZTogUGFnZSwgYWNjb3VudExhYmVsOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAvLyBDYWxsIGNsaWNrQWNjb3VudFNlbGVjdG9yIHRvIGdldCB0aGUgYXZhaWxhYmxlIGFjY291bnRzIGFuZCBvcGVuIHRoZSBkcm9wZG93blxyXG4gIGNvbnN0IGF2YWlsYWJsZUFjY291bnRzID0gYXdhaXQgY2xpY2tBY2NvdW50U2VsZWN0b3JHZXRBY2NvdW50SWRzKHBhZ2UpO1xyXG5cclxuICAvLyBDaGVjayBpZiB0aGUgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGF2YWlsYWJsZSBhY2NvdW50c1xyXG4gIGlmICghYXZhaWxhYmxlQWNjb3VudHMuaW5jbHVkZXMoYWNjb3VudExhYmVsKSkge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgLy8gV2FpdCBmb3IgdGhlIGRyb3Bkb3duIG9wdGlvbnMgdG8gYmUgcmVuZGVyZWRcclxuICBjb25zdCBvcHRpb25TZWxlY3RvciA9ICdtYXQtb3B0aW9uIC5tZGMtbGlzdC1pdGVtX19wcmltYXJ5LXRleHQnO1xyXG4gIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBvcHRpb25TZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XHJcblxyXG4gIC8vIFF1ZXJ5IGFsbCBtYXRjaGluZyBvcHRpb25zXHJcbiAgY29uc3QgYWNjb3VudE9wdGlvbnMgPSBhd2FpdCBwYWdlLiQkKG9wdGlvblNlbGVjdG9yKTtcclxuXHJcbiAgLy8gRmluZCBhbmQgY2xpY2sgdGhlIG9wdGlvbiBtYXRjaGluZyB0aGUgYWNjb3VudExhYmVsXHJcbiAgZm9yIChjb25zdCBvcHRpb24gb2YgYWNjb3VudE9wdGlvbnMpIHtcclxuICAgIGNvbnN0IHRleHQgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKGVsID0+IGVsLnRleHRDb250ZW50Py50cmltKCksIG9wdGlvbik7XHJcblxyXG4gICAgaWYgKHRleHQgPT09IGFjY291bnRMYWJlbCkge1xyXG4gICAgICBjb25zdCBvcHRpb25IYW5kbGUgPSBhd2FpdCBvcHRpb24uZXZhbHVhdGVIYW5kbGUoZWwgPT4gZWwgYXMgSFRNTEVsZW1lbnQpO1xyXG4gICAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKChlbDogSFRNTEVsZW1lbnQpID0+IGVsLmNsaWNrKCksIG9wdGlvbkhhbmRsZSk7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRUcmFuc2FjdGlvbnNGcmFtZShwYWdlOiBQYWdlKTogUHJvbWlzZTxGcmFtZSB8IG51bGw+IHtcclxuICAvLyBUcnkgYSBmZXcgdGltZXMgdG8gZmluZCB0aGUgaWZyYW1lLCBhcyBpdCBtaWdodCBub3QgYmUgaW1tZWRpYXRlbHkgYXZhaWxhYmxlXHJcbiAgZm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPCAzOyBhdHRlbXB0KyspIHtcclxuICAgIGF3YWl0IHNsZWVwKDIwMDApO1xyXG4gICAgY29uc3QgZnJhbWVzID0gcGFnZS5mcmFtZXMoKTtcclxuICAgIGNvbnN0IHRhcmdldEZyYW1lID0gZnJhbWVzLmZpbmQoZiA9PiBmLm5hbWUoKSA9PT0gSUZSQU1FX05BTUUpO1xyXG5cclxuICAgIGlmICh0YXJnZXRGcmFtZSkge1xyXG4gICAgICByZXR1cm4gdGFyZ2V0RnJhbWU7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc2VsZWN0QWNjb3VudEJvdGhVSXMocGFnZTogUGFnZSwgYWNjb3VudElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCBhY2NvdW50U2VsZWN0ZWQgPSBhd2FpdCBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2UsIGFjY291bnRJZCk7XHJcbiAgaWYgKCFhY2NvdW50U2VsZWN0ZWQpIHtcclxuICAgIC8vIE9sZCBVSSBmb3JtYXRcclxuICAgIGF3YWl0IHBhZ2Uuc2VsZWN0KCcjYWNjb3VudF9udW1fc2VsZWN0JywgYWNjb3VudElkKTtcclxuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2FjY291bnRfbnVtX3NlbGVjdCcsIHRydWUpO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMoXHJcbiAgcGFnZTogUGFnZSxcclxuICBzdGFydERhdGU6IE1vbWVudCxcclxuICBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMsXHJcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudD4ge1xyXG4gIC8vIFRyeSB0byBnZXQgdGhlIGlmcmFtZSBmb3IgdGhlIG5ldyBVSVxyXG4gIGNvbnN0IGZyYW1lID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zRnJhbWUocGFnZSk7XHJcblxyXG4gIC8vIFVzZSB0aGUgZnJhbWUgaWYgYXZhaWxhYmxlIChuZXcgVUkpLCBvdGhlcndpc2UgdXNlIHRoZSBwYWdlIGRpcmVjdGx5IChvbGQgVUkpXHJcbiAgY29uc3QgdGFyZ2V0UGFnZSA9IGZyYW1lIHx8IHBhZ2U7XHJcbiAgcmV0dXJuIGZldGNoQWNjb3VudERhdGEodGFyZ2V0UGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50cyhwYWdlOiBQYWdlLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50W10+IHtcclxuICBjb25zdCBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2UpO1xyXG5cclxuICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAvLyBJbiBjYXNlIGFjY291bnRzSWRzIGNvdWxkIG5vIGJlIHBhcnNlZCBqdXN0IHJldHVybiB0aGUgdHJhbnNhY3Rpb25zIG9mIHRoZSBjdXJyZW50bHkgc2VsZWN0ZWQgYWNjb3VudFxyXG4gICAgY29uc3QgYWNjb3VudERhdGEgPSBhd2FpdCBmZXRjaEFjY291bnREYXRhQm90aFVJcyhwYWdlLCBzdGFydERhdGUsIG9wdGlvbnMpO1xyXG4gICAgcmV0dXJuIFthY2NvdW50RGF0YV07XHJcbiAgfVxyXG5cclxuICBjb25zdCBhY2NvdW50czogVHJhbnNhY3Rpb25zQWNjb3VudFtdID0gW107XHJcbiAgZm9yIChjb25zdCBhY2NvdW50SWQgb2YgYWNjb3VudHNJZHMpIHtcclxuICAgIGF3YWl0IHNlbGVjdEFjY291bnRCb3RoVUlzKHBhZ2UsIGFjY291bnRJZCk7XHJcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XHJcbiAgICBhY2NvdW50cy5wdXNoKGFjY291bnREYXRhKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBhY2NvdW50cztcclxufVxyXG5cclxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHsgdXNlcm5hbWU6IHN0cmluZzsgcGFzc3dvcmQ6IHN0cmluZyB9O1xyXG5cclxuY2xhc3MgQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlciBleHRlbmRzIEJhc2VTY3JhcGVyV2l0aEJyb3dzZXI8U2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHM+IHtcclxuICBCQVNFX1VSTCA9ICcnO1xyXG5cclxuICBMT0dJTl9VUkwgPSAnJztcclxuXHJcbiAgVFJBTlNBQ1RJT05TX1VSTCA9ICcnO1xyXG5cclxuICBnZXRMb2dpbk9wdGlvbnMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBsb2dpblVybDogYCR7dGhpcy5MT0dJTl9VUkx9YCxcclxuICAgICAgZmllbGRzOiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFscyksXHJcbiAgICAgIHN1Ym1pdEJ1dHRvblNlbGVjdG9yOiAnI2NvbnRpbnVlQnRuJyxcclxuICAgICAgcG9zdEFjdGlvbjogYXN5bmMgKCkgPT4gd2FpdEZvclBvc3RMb2dpbih0aGlzLnBhZ2UpLFxyXG4gICAgICBwb3NzaWJsZVJlc3VsdHM6IGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCksXHJcbiAgICAgIC8vIEhBQ0s6IEZvciBzb21lIHJlYXNvbiwgdGhvdWdoIHRoZSBsb2dpbiBidXR0b24gKCNjb250aW51ZUJ0bikgaXMgcHJlc2VudCBhbmQgdmlzaWJsZSwgdGhlIGNsaWNrIGFjdGlvbiBkb2VzIG5vdCBwZXJmb3JtLlxyXG4gICAgICAvLyBBZGRpbmcgdGhpcyBkZWxheSBmaXhlcyB0aGUgaXNzdWUuXHJcbiAgICAgIHByZUFjdGlvbjogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGF3YWl0IHNsZWVwKDEwMDApO1xyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGZldGNoRGF0YSgpIHtcclxuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpLmFkZCgxLCAnZGF5Jyk7XHJcbiAgICBjb25zdCBzdGFydE1vbWVudExpbWl0ID0gbW9tZW50KHsgeWVhcjogMTYwMCB9KTtcclxuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xyXG4gICAgY29uc3Qgc3RhcnRNb21lbnQgPSBtb21lbnQubWF4KHN0YXJ0TW9tZW50TGltaXQsIG1vbWVudChzdGFydERhdGUpKTtcclxuXHJcbiAgICBhd2FpdCB0aGlzLm5hdmlnYXRlVG8odGhpcy5UUkFOU0FDVElPTlNfVVJMKTtcclxuXHJcbiAgICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IGZldGNoQWNjb3VudHModGhpcy5wYWdlLCBzdGFydE1vbWVudCwgdGhpcy5vcHRpb25zKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICBhY2NvdW50cyxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVs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