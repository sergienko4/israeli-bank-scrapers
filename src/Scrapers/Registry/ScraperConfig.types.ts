import { type SelectorCandidate } from '../Base/LoginConfig';

// ─── Config shape ────────────────────────────────────────────────────────────

export interface IBankScraperConfig {
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
  /** CSS selectors for DOM data scraping (post-login dashboard). */
  selectors: Record<string, SelectorCandidate[]>;
  /**
   * Hebrew text substrings that appear in the page body when credentials are wrong.
   * The base layer scans page text early (before the 20 s redirect timeout) and
   * returns InvalidPassword as soon as any pattern is found.
   * Leave as an empty array when no patterns are configured for this bank.
   */
  wrongCredentialTexts: readonly string[];
  /**
   * URL substrings that indicate a WAF/session redirect after login form submit.
   * When the page URL matches any of these patterns after the post-submit sleep,
   * the base layer returns WafBlocked so the engine fallback chain can retry.
   * Omit or leave undefined for banks without known WAF redirect patterns.
   */
  wafReturnUrls?: readonly string[];
}

// ─── Null-fill helpers (shared across banks) ─────────────────────────────────

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
export const NULL_AUTH: IBankScraperConfig['auth'] = {
  companyCode: null,
  countryCode: null,
  idType: null,
  checkLevel: null,
  organizationId: null,
};
export const NULL_FORMAT: IBankScraperConfig['format'] = {
  date: null,
  apiLang: null,
  numItemsPerPage: null,
  sortCode: null,
  maxRowsPerRequest: null,
};
export const NULL_TIMING: IBankScraperConfig['timing'] = {
  elementRenderMs: null,
  loginDelayMinMs: null,
  loginDelayMaxMs: null,
};
