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
  /** Login flow capabilities — drives pre/post-login behavior in BaseScraperWithBrowser. */
  loginSetup: {
    isApiOnly: boolean; // No browser login form (Amex, Isracard — API calls)
    hasOtpConfirm: boolean; // "Send me SMS" button before code entry (Beinleumi)
    hasOtpCode: boolean; // OTP code entry screen (Beinleumi, OneZero)
    hasSecondLoginStep: boolean; // Optional 2nd login form (Max Flow B)
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
  /** CSS selectors for DOM data scraping (post-login dashboard). */
  selectors: Record<string, SelectorCandidate[]>;
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
const SIMPLE_LOGIN: BankScraperConfig['loginSetup'] = {
  isApiOnly: false,
  hasOtpConfirm: false,
  hasOtpCode: false,
  hasSecondLoginStep: false,
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

// Column class strings (used for td class matching in BaseBeinleumiGroupHelpers) are
// intentionally NOT here — they are hardcoded in BaseBeinleumiGroupHelpers.ts.
const BEINLEUMI_DOM_SELECTORS: Record<string, SelectorCandidate[]> = {
  accountsNumber: [{ kind: 'css', value: 'div.fibi_account span.acc_num' }],
  completedTransactionsTable: [{ kind: 'css', value: 'table#dataTable077' }],
  pendingTransactionsTable: [{ kind: 'css', value: 'table#dataTable023' }],
  nextPageLink: [{ kind: 'css', value: 'a#Npage.paging' }],
  currentBalance: [{ kind: 'css', value: '.main_balance' }],
  transactionsTab: [{ kind: 'css', value: 'a#tabHeader4' }],
  datesContainer: [{ kind: 'css', value: 'div#fibi_dates' }],
  fromDateInput: [{ kind: 'css', value: 'input#fromDate' }],
  showButton: [{ kind: 'css', value: 'input[value=הצג]' }],
  tableContainer: [{ kind: 'css', value: "div[id*='divTable']" }],
  closeDatePickerBtn: [{ kind: 'css', value: 'button.ui-datepicker-close' }],
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
      loginSetup: SIMPLE_LOGIN,
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
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD.MM.YY' },
      timing: NULL_TIMING,
      selectors: {
        advancedSearchBtn: [{ kind: 'css', value: 'button[title="חיפוש מתקדם"]' }],
        dateRangeRadio: [{ kind: 'css', value: 'bll-radio-button:not([checked])' }],
        dateFromInput: [{ kind: 'css', value: 'input[formcontrolname="txtInputFrom"]' }],
        filterBtn: [{ kind: 'ariaLabel', value: 'סנן' }],
        accountListItems: [
          { kind: 'css', value: 'app-masked-number-combo span.display-number-li' },
        ],
        accountCombo: [
          {
            kind: 'xpath',
            value: '//*[contains(@class, "number") and contains(@class, "combo-inner")]',
          },
        ],
      },
    },
    [CompanyTypes.Discount]: {
      urls: { base: 'https://www.discountbank.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://start.telebank.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'YYYYMMDD' },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Mercantile]: {
      urls: { base: 'https://www.mercantile.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://start.telebank.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
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
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY', maxRowsPerRequest: 10000000000 },
      timing: NULL_TIMING,
      selectors: {
        accountDropdown: [{ kind: 'css', value: '#dropdownBasic, .item' }],
        accountDropdownItem: [{ kind: 'css', value: '#AccountPicker .item' }],
        accountNumberSpan: [{ kind: 'css', value: '#dropdownBasic b span' }],
        pendingTransactionRows: [{ kind: 'css', value: 'tr.rgRow, tr.rgAltRow' }],
        pendingFrameIdentifier: [{ kind: 'css', value: '#ctl00_ContentPlaceHolder2_panel1' }],
        oshLink: [{ kind: 'css', value: 'a[href*="/osh/legacy/legacy-Osh-Main"]' }],
        transactionsLink: [{ kind: 'css', value: 'a[href*="/osh/legacy/root-main-osh-p428New"]' }],
        pendingTransactionsLink: [{ kind: 'css', value: 'a[href*="/osh/legacy/legacy-Osh-p420"]' }],
      },
    },
    [CompanyTypes.Max]: {
      urls: { base: 'https://www.max.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://onlinelcapi.max.co.il' },
      auth: NULL_AUTH,
      loginSetup: { ...SIMPLE_LOGIN, hasSecondLoginStep: true },
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Amex]: {
      urls: { base: 'https://americanexpress.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://he.americanexpress.co.il' },
      auth: { ...NULL_AUTH, companyCode: '77', countryCode: '212', idType: '1', checkLevel: '1' },
      loginSetup: { ...SIMPLE_LOGIN, isApiOnly: true },
      format: NULL_FORMAT,
      timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
      selectors: {},
    },
    [CompanyTypes.Isracard]: {
      urls: { base: 'https://www.isracard.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://digital.isracard.co.il' },
      auth: { ...NULL_AUTH, companyCode: '11', countryCode: '212', idType: '1', checkLevel: '1' },
      loginSetup: { ...SIMPLE_LOGIN, isApiOnly: true },
      format: NULL_FORMAT,
      timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
      selectors: {},
    },
    [CompanyTypes.VisaCal]: {
      urls: { base: 'https://www.cal-online.co.il/', loginRoute: null, transactions: null },
      api: VISACAL_API,
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
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
      loginSetup: { ...SIMPLE_LOGIN, hasOtpConfirm: true, hasOtpCode: true },
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
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
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
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
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
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
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
    },
    [CompanyTypes.Behatsdaa]: {
      urls: { base: 'https://www.behatsdaa.org.il', loginRoute: null, transactions: null },
      api: {
        ...NULL_API,
        purchaseHistory: 'https://back.behatsdaa.org.il/api/purchases/purchaseHistory',
      },
      auth: { ...NULL_AUTH, organizationId: '20' },
      loginSetup: SIMPLE_LOGIN,
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.BeyahadBishvilha]: {
      urls: { base: 'https://www.hist.org.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, card: 'https://www.hist.org.il/card/balanceAndUses' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YY' },
      timing: NULL_TIMING,
      selectors: {
        transactionContainer: [
          { kind: 'css', value: '.transaction-container, .transaction-component-container' },
        ],
        transactionColumns: [{ kind: 'css', value: '.transaction-item > span' }],
        cardNumber: [{ kind: 'css', value: '.wallet-details div:nth-of-type(2)' }],
        balance: [
          { kind: 'css', value: '.wallet-details div:nth-of-type(4) > span:nth-of-type(2)' },
        ],
        loadingIndicator: [{ kind: 'css', value: '.react-loading.hide' }],
      },
    },
    [CompanyTypes.Yahav]: {
      urls: { base: 'https://www.yahav.co.il', loginRoute: null, transactions: null },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: NULL_TIMING,
      selectors: {
        accountDetails: [{ kind: 'css', value: '.account-details' }],
        accountId: [
          {
            kind: 'css',
            value: 'span.portfolio-value[ng-if="mainController.data.portfolioList.length === 1"]',
          },
        ],
        transactionRows: [{ kind: 'css', value: '.list-item-holder .entire-content-ctr' }],
        transactionTableHeader: [{ kind: 'css', value: '.under-line-txn-table-header' }],
        datePickerOpener: [
          {
            kind: 'css',
            value:
              'div.date-options-cell:nth-child(7) > date-picker:nth-child(1) > div:nth-child(1) > span:nth-child(2)',
          },
        ],
        monthPickerBtn: [{ kind: 'css', value: '.pmu-month' }],
        loadingSpinner: [{ kind: 'css', value: '.loading-bar-spinner' }],
        monthsGridCheck: [{ kind: 'css', value: '.pmu-months > div:nth-child(1)' }],
        yearsGridCheck: [{ kind: 'css', value: '.pmu-years > div:nth-child(1)' }],
      },
    },
    [CompanyTypes.OneZero]: {
      urls: { base: 'https://www.onezero.co.il', loginRoute: null, transactions: null },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: { ...SIMPLE_LOGIN, hasOtpCode: true },
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
  } satisfies Record<CompanyTypes, BankScraperConfig>,

  /** Global login-field fallback dictionary used by SelectorResolver on every bank */
  wellKnownSelectors: {
    username: [
      { kind: 'labelText', value: 'שם משתמש' },
      { kind: 'labelText', value: 'קוד משתמש' },
      { kind: 'labelText', value: 'מספר לקוח' },
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'קוד משתמש' },
      { kind: 'placeholder', value: 'מספר לקוח' },
      { kind: 'placeholder', value: 'תז' },
      { kind: 'css', value: '#username' }, // Beinleumi group, Yahav
      { kind: 'css', value: '#user-name' }, // Max
      { kind: 'css', value: '[formcontrolname="userName"]' }, // VisaCal (Angular Material)
      { kind: 'ariaLabel', value: 'שם משתמש' },
      { kind: 'ariaLabel', value: 'קוד משתמש' },
      { kind: 'name', value: 'username' },
      { kind: 'name', value: 'userCode' },
    ],
    userCode: [
      { kind: 'labelText', value: 'קוד משתמש' },
      { kind: 'labelText', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'קוד משתמש' },
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'מספר לקוח' },
      { kind: 'css', value: '#userCode' }, // Hapoalim
      { kind: 'ariaLabel', value: 'קוד משתמש' },
      { kind: 'name', value: 'userCode' },
      { kind: 'name', value: 'username' },
    ],
    password: [
      { kind: 'labelText', value: 'סיסמה' },
      { kind: 'labelText', value: 'סיסמא' },
      { kind: 'labelText', value: 'קוד סודי' },
      { kind: 'placeholder', value: 'סיסמה' },
      { kind: 'placeholder', value: 'סיסמא' },
      { kind: 'placeholder', value: 'קוד סודי' },
      { kind: 'css', value: 'input[type="password"]' },
      { kind: 'css', value: '#password' }, // Hapoalim, Max, Beinleumi, Yahav
      { kind: 'css', value: '#loginPassword' }, // Behatsdaa, BeyahadBishvilha
      { kind: 'css', value: '#tzPassword' }, // Discount
      { kind: 'css', value: '[formcontrolname="password"]' }, // VisaCal (Angular Material)
      { kind: 'ariaLabel', value: 'סיסמה' },
      { kind: 'name', value: 'password' },
    ],
    id: [
      { kind: 'labelText', value: 'תעודת זהות' },
      { kind: 'labelText', value: 'מספר זהות' },
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'מספר זהות' },
      { kind: 'placeholder', value: 'ת.ז' },
      { kind: 'css', value: '#loginId' }, // Behatsdaa, BeyahadBishvilha
      { kind: 'css', value: '#tzId' }, // Discount
      { kind: 'ariaLabel', value: 'תעודת זהות' },
      { kind: 'name', value: 'id' },
    ],
    nationalID: [
      { kind: 'labelText', value: 'תעודת זהות' },
      { kind: 'labelText', value: 'מספר זהות' },
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'מספר זהות' },
      { kind: 'css', value: '#pinno' }, // Yahav
      { kind: 'ariaLabel', value: 'תעודת זהות' },
      { kind: 'name', value: 'nationalID' },
      { kind: 'name', value: 'id' },
    ],
    card6Digits: [
      { kind: 'labelText', value: 'ספרות' },
      { kind: 'placeholder', value: '6 ספרות' },
      { kind: 'placeholder', value: 'ספרות הכרטיס' },
      { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
    ],
    num: [
      { kind: 'labelText', value: 'קוד מזהה' },
      { kind: 'labelText', value: 'מספר חשבון' },
      { kind: 'placeholder', value: 'מספר חשבון' },
      { kind: 'css', value: '#aidnum' }, // Discount
      { kind: 'ariaLabel', value: 'מספר חשבון' },
      { kind: 'name', value: 'num' },
    ],
    otpCode: [
      { kind: 'labelText', value: 'קוד חד פעמי' },
      { kind: 'labelText', value: 'קוד אימות' },
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

  /** Global dashboard-field fallback dictionary used by resolveDashboardField() */
  wellKnownDashboardSelectors: {
    balance: [
      { kind: 'css', value: '.balance' },
      { kind: 'css', value: '[data-testid="balance"]' },
      { kind: 'ariaLabel', value: 'יתרה' },
      { kind: 'ariaLabel', value: 'balance' },
    ],
    loadingIndicator: [
      { kind: 'css', value: '.react-loading.hide' },
      { kind: 'css', value: '[data-loading]' },
      { kind: 'css', value: '.spinner' },
    ],
    /** Generic date-from filter input — Hebrew placeholder variants + HTML5 date input */
    fromDateInput: [
      { kind: 'placeholder', value: 'מתאריך' },
      { kind: 'placeholder', value: 'מהתאריך' },
      { kind: 'placeholder', value: 'תאריך התחלה' },
      { kind: 'css', value: 'input[type="date"]' },
    ],
    /** Generic loading spinner — Yahav, generic patterns */
    loadingSpinner: [
      { kind: 'css', value: '.loading-bar-spinner' },
      { kind: 'css', value: '.loading' },
      { kind: 'css', value: '[role="progressbar"]' },
    ],
  } satisfies Record<string, SelectorCandidate[]>,
} as const;
