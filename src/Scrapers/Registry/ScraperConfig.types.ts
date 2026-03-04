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
  /** CSS selectors for DOM data scraping (post-login dashboard). */
  selectors: Record<string, SelectorCandidate[]>;
}

// ─── Null-fill helpers (shared across banks) ─────────────────────────────────

export const NULL_API: BankScraperConfig['api'] = {
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
export const NULL_AUTH: BankScraperConfig['auth'] = {
  companyCode: null,
  countryCode: null,
  idType: null,
  checkLevel: null,
  organizationId: null,
};
export const NULL_FORMAT: BankScraperConfig['format'] = {
  date: null,
  apiLang: null,
  numItemsPerPage: null,
  sortCode: null,
  maxRowsPerRequest: null,
};
export const NULL_TIMING: BankScraperConfig['timing'] = {
  elementRenderMs: null,
  loginDelayMinMs: null,
  loginDelayMaxMs: null,
};
