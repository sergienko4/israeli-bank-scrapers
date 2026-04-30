import { type OtpConfig, type SelectorCandidate } from '../../Base/Config/LoginConfig.js';

// ---- Config shape ----

/** Per-bank scraper configuration — URLs, API endpoints, auth, format, timing, selectors. */
export interface IBankScraperConfig {
  /** Browser navigation URLs */
  urls: {
    base: string | null;
    loginRoute: string | null;
    transactions: string | null;
    portalUrl?: string | null;
  };
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
    /** Proxy login reqName (e.g., 'performLogonI'). Null if no proxy auth needed. */
    loginReqName: string | null;
  };
  /** Login flow capabilities — drives pre/post-login behavior. */
  loginSetup: {
    isApiOnly: boolean;
    hasOtpConfirm: boolean;
    hasOtpCode: boolean;
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
  loginReqName: null,
};

/** Default simple login setup — no OTP, not API-only. */
export const SIMPLE_LOGIN: IBankScraperConfig['loginSetup'] = {
  isApiOnly: false,
  hasOtpConfirm: false,
  hasOtpCode: false,
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

/** Default DOM-based OTP config — shared by all banks with browser OTP flow. */
export const DOM_OTP: OtpConfig = {
  kind: 'dom',
  triggerSelectors: [
    { kind: 'clickableText', value: 'שלח קוד' },
    { kind: 'clickableText', value: 'שלח' },
    { kind: 'clickableText', value: 'לקבלת סיסמה חד פעמית' },
    { kind: 'ariaLabel', value: 'שלח' },
    { kind: 'ariaLabel', value: 'שלח קוד' },
  ],
  inputSelectors: [
    { kind: 'placeholder', value: 'קוד חד פעמי' },
    { kind: 'placeholder', value: 'סיסמה חד פעמית' },
    { kind: 'placeholder', value: 'קוד SMS' },
    { kind: 'name', value: 'otpCode' },
  ],
  submitSelectors: [
    { kind: 'clickableText', value: 'אישור' },
    { kind: 'clickableText', value: 'אשר' },
    { kind: 'clickableText', value: 'שלח' },
    { kind: 'ariaLabel', value: 'אישור' },
  ],
  longTermTokenSupported: false,
};
