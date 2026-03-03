/* eslint-disable max-lines */
import { CompanyTypes } from '../../Definitions';
import { type SelectorCandidate } from '../Base/LoginConfig';

// ─── Config shape ────────────────────────────────────────────────────────────

export interface BankScraperConfig {
  /** Browser navigation URLs */
  urls: {
    base: string | null; // Official home page — no subdomain, no path
    loginRoute: string | null; // Angular/CGI route (checkReadiness nav)
    transactions: string | null; // Full URL to the transactions page/portal
  };
  /** REST API endpoints */
  api: {
    base: string | null; // Alternate/portal API domain
    purchaseHistory: string | null; // Behatsdaa
    card: string | null; // BeyahadBishvilha
    calTransactions: string | null;
    calFrames: string | null;
    calPending: string | null;
    calInit: string | null;
    calLoginResponse: string | null;
    calOrigin: string | null;
    calXSiteId: string | null;
  };
  /** Authentication identifiers */
  auth: {
    companyCode: string | null; // Amex: '77', Isracard: '11'
    countryCode: string | null; // Israel: '212'
    idType: string | null;
    checkLevel: string | null;
    organizationId: string | null; // Behatsdaa: '20'
  };
  /** Data format and pagination */
  format: {
    date: string | null; // moment.js format string
    apiLang: string | null;
    numItemsPerPage: number | null;
    sortCode: number | null;
    maxRowsPerRequest: number | null;
  };
  /** Timing and delays */
  timing: {
    elementRenderMs: number | null;
    loginDelayMinMs: number | null;
    loginDelayMaxMs: number | null;
  };
  /** CSS selectors for DOM data scraping */
  selectors: Record<string, string>;
}

// ─── Null-fill helpers (shared across banks) ─────────────────────────────────

const NULL_API: BankScraperConfig['api'] = {
  base: null,
  purchaseHistory: null,
  card: null,
  calTransactions: null,
  calFrames: null,
  calPending: null,
  calInit: null,
  calLoginResponse: null,
  calOrigin: null,
  calXSiteId: null,
};
const NULL_AUTH: BankScraperConfig['auth'] = {
  companyCode: null,
  countryCode: null,
  idType: null,
  checkLevel: null,
  organizationId: null,
};
const NULL_FORMAT: BankScraperConfig['format'] = {
  date: null,
  apiLang: null,
  numItemsPerPage: null,
  sortCode: null,
  maxRowsPerRequest: null,
};
const NULL_TIMING: BankScraperConfig['timing'] = {
  elementRenderMs: null,
  loginDelayMinMs: null,
  loginDelayMaxMs: null,
};

// ─── Shared selector sets ─────────────────────────────────────────────────────

const BEINLEUMI_SELECTORS: Record<string, string> = {
  accountsNumber: 'div.fibi_account span.acc_num',
  completedTransactionsTable: 'table#dataTable077',
  pendingTransactionsTable: 'table#dataTable023',
  nextPageLink: 'a#Npage.paging',
  currentBalance: '.main_balance',
  transactionsTab: 'a#tabHeader4',
  datesContainer: 'div#fibi_dates',
  fromDateInput: 'input#fromDate',
  showButton: 'input[value=הצג]',
  tableContainer: "div[id*='divTable']",
  closeDatePickerClass: 'ui-datepicker-close',
  dateColumnCompleted: 'date first',
  dateColumnPending: 'first date',
  descriptionColumnCompleted: 'reference wrap_normal',
  descriptionColumnPending: 'details wrap_normal',
  referenceColumn: 'details',
  debitColumn: 'debit',
  creditColumn: 'credit',
  errorMessageClass: 'NO_DATA',
};

const VISACAL_API: BankScraperConfig['api'] = {
  base: null,
  purchaseHistory: null,
  card: null,
  calTransactions:
    'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails',
  calFrames: 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus',
  calPending: 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests',
  calInit: 'https://api.cal-online.co.il/Authentication/api/account/init',
  calLoginResponse: '/col-rest/calconnect/authentication/login',
  calOrigin: 'https://digital-web.cal-online.co.il',
  calXSiteId: '09031987-273E-2311-906C-8AF85B17C8D9',
};

// ─── Central scraper configuration ───────────────────────────────────────────

export const SCRAPER_CONFIGURATION = {
  banks: {
    [CompanyTypes.Hapoalim]: {
      urls: { base: 'https://www.bankhapoalim.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://login.bankhapoalim.co.il' },
      auth: NULL_AUTH,
      format: {
        ...NULL_FORMAT,
        date: 'YYYYMMDD',
        apiLang: 'he',
        numItemsPerPage: 1000,
        sortCode: 1,
      },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Leumi]: {
      urls: {
        base: 'https://www.leumi.co.il',
        loginRoute: null,
        transactions:
          'https://hb2.bankleumi.co.il/eBanking/SO/SPA.aspx#/ts/BusinessAccountTrx?WidgetPar=1',
      },
      api: { ...NULL_API, base: 'https://hb2.bankleumi.co.il' },
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD.MM.YY' },
      timing: NULL_TIMING,
      selectors: {
        advancedSearchBtn: 'button[title="חיפוש מתקדם"]',
        dateRangeRadio: 'bll-radio-button:not([checked])',
        dateFromInput: 'input[formcontrolname="txtInputFrom"]',
        filterBtn: "button[aria-label='סנן']",
        accountListItems: 'app-masked-number-combo span.display-number-li',
        accountCombo: 'xpath=//*[contains(@class, "number") and contains(@class, "combo-inner")]',
      },
    },
    [CompanyTypes.Discount]: {
      urls: { base: 'https://www.discountbank.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://start.telebank.co.il' },
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'YYYYMMDD' },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Mercantile]: {
      urls: { base: 'https://www.mercantile.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://start.telebank.co.il' },
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'YYYYMMDD' },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Mizrahi]: {
      urls: {
        base: 'https://www.mizrahi-tefahot.co.il',
        loginRoute: 'https://www.mizrahi-tefahot.co.il/login/index.html#/auth-page-he',
        transactions: null,
      },
      api: { ...NULL_API, base: 'https://mto.mizrahi-tefahot.co.il' },
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY', maxRowsPerRequest: 10000000000 },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Max]: {
      urls: { base: 'https://www.max.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://onlinelcapi.max.co.il' },
      auth: NULL_AUTH,
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Amex]: {
      urls: { base: 'https://americanexpress.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://he.americanexpress.co.il' },
      auth: { ...NULL_AUTH, companyCode: '77', countryCode: '212', idType: '1', checkLevel: '1' },
      format: NULL_FORMAT,
      timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
      selectors: {},
    },
    [CompanyTypes.Isracard]: {
      urls: { base: 'https://www.isracard.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://digital.isracard.co.il' },
      auth: { ...NULL_AUTH, companyCode: '11', countryCode: '212', idType: '1', checkLevel: '1' },
      format: NULL_FORMAT,
      timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
      selectors: {},
    },
    [CompanyTypes.VisaCal]: {
      urls: { base: 'https://www.cal-online.co.il/', loginRoute: null, transactions: null },
      api: VISACAL_API,
      auth: NULL_AUTH,
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Beinleumi]: {
      urls: {
        base: 'https://www.fibi.co.il',
        loginRoute: null,
        transactions:
          'https://online.fibi.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_SELECTORS,
    },
    [CompanyTypes.OtsarHahayal]: {
      urls: {
        base: 'https://www.bankotsar.co.il',
        loginRoute: null,
        transactions:
          'https://online.bankotsar.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_SELECTORS,
    },
    [CompanyTypes.Massad]: {
      urls: {
        base: 'https://www.bankmassad.co.il',
        loginRoute: null,
        transactions:
          'https://online.bankmassad.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_SELECTORS,
    },
    [CompanyTypes.Pagi]: {
      urls: {
        base: 'https://www.pagi.co.il',
        loginRoute: null,
        transactions:
          'https://online.pagi.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_SELECTORS,
    },
    [CompanyTypes.Behatsdaa]: {
      urls: { base: 'https://www.behatsdaa.org.il', loginRoute: null, transactions: null },
      api: {
        ...NULL_API,
        purchaseHistory: 'https://back.behatsdaa.org.il/api/purchases/purchaseHistory',
      },
      auth: { ...NULL_AUTH, organizationId: '20' },
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.BeyahadBishvilha]: {
      urls: { base: 'https://www.hist.org.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, card: 'https://www.hist.org.il/card/balanceAndUses' },
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD/MM/YY' },
      timing: NULL_TIMING,
      selectors: {
        transactionContainer: '.transaction-container, .transaction-component-container',
        transactionColumns: '.transaction-item > span',
        cardNumber: '.wallet-details div:nth-of-type(2)',
        balance: '.wallet-details div:nth-of-type(4) > span:nth-of-type(2)',
        loadingIndicator: '.react-loading.hide',
      },
    },
    [CompanyTypes.Yahav]: {
      urls: { base: 'https://www.yahav.co.il', loginRoute: null, transactions: null },
      api: NULL_API,
      auth: NULL_AUTH,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: NULL_TIMING,
      selectors: {
        accountDetails: '.account-details',
        accountId: 'span.portfolio-value[ng-if="mainController.data.portfolioList.length === 1"]',
        transactionRows: '.list-item-holder .entire-content-ctr',
        transactionTableHeader: '.under-line-txn-table-header',
        datePickerOpener:
          'div.date-options-cell:nth-child(7) > date-picker:nth-child(1) > div:nth-child(1) > span:nth-child(2)',
        monthPickerBtn: '.pmu-month',
        loadingSpinner: '.loading-bar-spinner',
        monthsGridCheck: '.pmu-months > div:nth-child(1)',
        yearsGridCheck: '.pmu-years > div:nth-child(1)',
      },
    },
    [CompanyTypes.OneZero]: {
      urls: { base: 'https://www.onezero.co.il', loginRoute: null, transactions: null },
      api: NULL_API,
      auth: NULL_AUTH,
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
  } satisfies Record<CompanyTypes, BankScraperConfig>,

  /** Global login-field fallback dictionary used by SelectorResolver on every bank */
  wellKnownSelectors: {
    username: [
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'קוד משתמש' },
      { kind: 'placeholder', value: 'מספר לקוח' },
      { kind: 'placeholder', value: 'תז' },
      { kind: 'ariaLabel', value: 'שם משתמש' },
      { kind: 'ariaLabel', value: 'קוד משתמש' },
      { kind: 'name', value: 'username' },
      { kind: 'name', value: 'userCode' },
    ],
    userCode: [
      { kind: 'placeholder', value: 'קוד משתמש' },
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'מספר לקוח' },
      { kind: 'ariaLabel', value: 'קוד משתמש' },
      { kind: 'name', value: 'userCode' },
      { kind: 'name', value: 'username' },
    ],
    password: [
      { kind: 'placeholder', value: 'סיסמה' },
      { kind: 'placeholder', value: 'סיסמא' },
      { kind: 'placeholder', value: 'קוד סודי' },
      { kind: 'ariaLabel', value: 'סיסמה' },
      { kind: 'name', value: 'password' },
      { kind: 'css', value: 'input[type="password"]' },
    ],
    id: [
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'מספר זהות' },
      { kind: 'placeholder', value: 'ת.ז' },
      { kind: 'ariaLabel', value: 'תעודת זהות' },
      { kind: 'name', value: 'id' },
    ],
    nationalID: [
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'מספר זהות' },
      { kind: 'ariaLabel', value: 'תעודת זהות' },
      { kind: 'name', value: 'nationalID' },
      { kind: 'name', value: 'id' },
    ],
    card6Digits: [
      { kind: 'placeholder', value: '6 ספרות' },
      { kind: 'placeholder', value: 'ספרות הכרטיס' },
      { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
    ],
    num: [
      { kind: 'placeholder', value: 'מספר חשבון' },
      { kind: 'ariaLabel', value: 'מספר חשבון' },
      { kind: 'name', value: 'num' },
    ],
    otpCode: [
      { kind: 'placeholder', value: 'קוד חד פעמי' },
      { kind: 'placeholder', value: 'קוד SMS' },
      { kind: 'placeholder', value: 'קוד אימות' },
      { kind: 'placeholder', value: 'הזן קוד' },
      { kind: 'name', value: 'otpCode' },
    ],
    /** Universal submit-button fallback — tried after every bank's explicit submit candidate */
    __submit__: [
      { kind: 'css', value: 'button[type="submit"]' },
      { kind: 'ariaLabel', value: 'כניסה' },
      { kind: 'ariaLabel', value: 'התחברות' },
      { kind: 'ariaLabel', value: 'התחבר' },
      { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
      { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
      { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    ],
  } satisfies Record<string, SelectorCandidate[]>,
} as const;
