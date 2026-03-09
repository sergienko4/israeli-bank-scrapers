import { type SelectorCandidate } from '../Base/LoginConfig.js';

// ---- Config shape ----

/** Per-bank scraper configuration — URLs, API endpoints, auth, format, timing, selectors. */
export interface IBankScraperConfig {
  /** Browser navigation URLs */
  urls: { base: string | null; loginRoute: string | null; transactions: string | null };
  /** REST API endpoints */
  api: {
    base: string | null;
    purchaseHistory: string | null;
    card: string | null;
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
    companyCode: string | null;
    countryCode: string | null;
    idType: string | null;
    checkLevel: string | null;
    organizationId: string | null;
  };
  /** Login flow capabilities — drives pre/post-login behavior. */
  loginSetup: {
    isApiOnly: boolean;
    hasOtpConfirm: boolean;
    hasOtpCode: boolean;
    hasSecondLoginStep: boolean;
  };
  /** Data format and pagination */
  format: {
    date: string | null;
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

// ---- Null-fill helpers (shared across banks) ----

/** Default API config with all endpoints set to null. */
export const NULL_API: IBankScraperConfig['api'] = {
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

/** Default auth config with all fields set to null. */
export const NULL_AUTH: IBankScraperConfig['auth'] = {
  companyCode: null,
  countryCode: null,
  idType: null,
  checkLevel: null,
  organizationId: null,
};

/** Default simple login setup — no OTP, no second step, not API-only. */
export const SIMPLE_LOGIN: IBankScraperConfig['loginSetup'] = {
  isApiOnly: false,
  hasOtpConfirm: false,
  hasOtpCode: false,
  hasSecondLoginStep: false,
};

/** Default format config with all fields set to null. */
export const NULL_FORMAT: IBankScraperConfig['format'] = {
  date: null,
  apiLang: null,
  numItemsPerPage: null,
  sortCode: null,
  maxRowsPerRequest: null,
};

/** Default timing config with all fields set to null. */
export const NULL_TIMING: IBankScraperConfig['timing'] = {
  elementRenderMs: null,
  loginDelayMinMs: null,
  loginDelayMaxMs: null,
};

// ---- Shared selector sets ----

// Column class strings (used for td class matching in BaseBeinleumiGroupHelpers) are
// intentionally NOT here — they are hardcoded in BaseBeinleumiGroupHelpers.ts.

/** DOM selectors shared by all Beinleumi-group banks (Beinleumi, OtsarHahayal, Massad, Pagi). */
export const BEINLEUMI_DOM_SELECTORS: Record<string, SelectorCandidate[]> = {
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

/** VisaCal API endpoint configuration. */
export const VISACAL_API: IBankScraperConfig['api'] = {
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
