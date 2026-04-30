/** Scrape phase WK — signature keys, API patterns, transaction field mappings. */

/** Known date formats across Israeli banks. */
export const KNOWN_DATE_FORMATS: string[] = [
  'YYYYMMDD',
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'YYYY-MM-DDTHH:mm:ss',
  'DD-MM-YYYY',
  'YYYY.MM.DD',
  'DD.MM.YYYY',
  'YYYY.MM.DDTHH:mm:ss',
];

/** Key patterns that indicate an ACCOUNT/CARD response (billing data). */
export const ACCOUNT_SIGNATURE_KEYS = /billing|charges|cardsCharges/i;

/** Key patterns that indicate a TRANSACTION response (amount/date/description). */
export const TXN_SIGNATURE_KEYS = /originalAmount|fullPurchaseDate|transactionDate/i;

// ── API endpoint URL patterns ─────────────────────────────────────────────────────

/** WellKnown API endpoint patterns — regex patterns for network discovery. */
export const PIPELINE_WELL_KNOWN_API = {
  accounts: [
    /userAccountsData/i,
    /account\/init/i,
    /account\/info/i,
    /\/Init$/i,
    /GetCOLMetadata/i,
    /accountSummary/i,
  ],
  transactions: [
    /TransactionsAndGraphs/i,
    /transactions?Details/i,
    /filteredTransactions/i,
    /lastTransactions/i,
    /transactions\/list/i,
    /transactions\/v\d/i,
    /current-account\/transactions/i,
    /getTransactions/i,
  ],
  balance: [/infoAndBalance/i, /dashboardBalances/i, /GetFrameStatus/i, /Frames.*api/i],
  auth: [/authentication\/login/i, /authentication\//i, /verification/i, /loginSuccess/i],
  pending: [/approvals/i, /getClearanceRequests/i, /FutureTransaction/i],
  proxy: [/ProxyRequestHandler/i, /ServiceEndpoint/i],
  /** Proxy dashboard request names — fired via proxy to discover accounts. */
  proxyDashboard: [/DashboardMonth/i, /CardsList/i, /AccountsList/i],
  /** Proxy transaction request names — fired via proxy to fetch transactions. */
  proxyTransactions: [/CardsTransactionsList/i, /TransactionsList/i],
} satisfies Record<string, RegExp[]>;

/** WellKnown proxy query parameter defaults — common across proxy-based banks. */
export const PIPELINE_WELL_KNOWN_PROXY = {
  /** Default query params appended to proxy requests. */
  queryDefaults: 'actionCode=0&format=Json',
} as const;

/** WellKnown SPA query-param keys — URL shape hints (not bank-specific). */
export const PIPELINE_WELL_KNOWN_QUERY_KEYS = {
  /** Query key used by SPAs that page monthly filter state through the URL. */
  filterData: 'filterData',
} as const;

/** WellKnown path fragments for the shared credit-card billing-cycle API.
 *  Card-family backends (CAL / Isracard / Amex / MAX) all expose
 *  `/Transactions/api/<pathFragment>/<actionName>` — the PATH is shared
 *  backend infrastructure, not a bank identity. Fragments are combined
 *  with the discovered API origin at call time; no hostname is hardcoded. */
export const PIPELINE_WELL_KNOWN_BILLING = {
  /** Parent path segment of the billing-cycle API. Presence in any
   *  captured URL proves the bank's backend exposes the family. */
  pathFragment: 'transactionsDetails',
  /** Leaf action returning per-card monthly transactions. */
  actionName: 'getCardTransactionsDetails',
  /** API prefix under the bank's origin — shared by all card backends. */
  apiPrefix: '/Transactions/api',
} as const;

/** WellKnown header name patterns for network discovery. */
export const PIPELINE_WELL_KNOWN_HEADERS = {
  /** Request header names that carry the API origin. */
  origin: ['origin', 'referer'],
  /** Request header names that carry a site/session ID. */
  siteId: ['x-site-id', 'x-session-id'],
  /** Browser-standard headers to exclude when extracting SPA-specific headers. */
  browserStandard: new Set([
    'accept',
    'accept-encoding',
    'accept-language',
    'cache-control',
    'connection',
    'content-length',
    'content-type',
    'cookie',
    'host',
    'origin',
    'pragma',
    'referer',
    'user-agent',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'upgrade-insecure-requests',
    'authorization',
  ]),
} as const;

export {
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS,
  PIPELINE_WELL_KNOWN_RESPONSE_FIELDS,
  PIPELINE_WELL_KNOWN_TXN_FIELDS,
} from './ScrapeFieldMappings.js';
