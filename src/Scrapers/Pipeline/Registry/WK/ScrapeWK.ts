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
    /GetCardList/i,
  ],
  transactions: [
    /TransactionsAndGraphs/i,
    // PLURAL only: a list/collection endpoint. The earlier optional-`s`
    // form (`transactions?Details`) also matched single-record action /
    // popup endpoints (e.g. Max `GetTransactionDetailsActions`,
    // `transactionDetails/getDapapRegistrationPopup`) that do NOT serve
    // transaction data — picking one of those over the real fetcher led
    // to 0-txn Max scrapes. The plural-vs-singular split is the bank-
    // agnostic naming convention list endpoints follow (verified across
    // all 7 captured-trace banks).
    /transactionsDetails/i,
    /filteredTransactions/i,
    /lastTransactions/i,
    /transactions\/list/i,
    /transactions\/v\d/i,
    /current-account\/transactions/i,
    // `Get<verb-or-modifier>?Transactions` covers the card-family naming
    // convention shared by Amex/Isracard's StatusPage endpoints:
    //   • `GetLatestTransactions` — real txn list (POST, replayable)
    //   • `GetTransactionsList`   — Isracard txn list (POST)
    //   • `GetTransactions`       — bare-form, used by some banks
    // The earlier `/getTransactions/i` form only matched contiguous
    // `getTransactions`, so `GetLatestTransactions` (with `Latest`
    // between `Get` and `Transactions`) silently fell through and the
    // GET `GetTransactionsContent` (UI text labels) was selected
    // instead → 0-txn Amex scrapes. `\w*` lets a single word slot in
    // between, matching all three real list-endpoint shapes while
    // still routing through `discoverShapeAware`'s POST-with-shape
    // preference (no broader risk than the original pattern).
    /get\w*Transactions/i,
  ],
  balance: [/infoAndBalance/i, /dashboardBalances/i, /GetFrameStatus/i, /Frames.*api/i],
  // Auth endpoint patterns — cover every migrated bank's credentials
  // submission URL. Verified against real network captures in
  // `C:\tmp\runs\pipeline\<bank>\.../network\` for:
  //   - Beinleumi    → /api/v2/auth/login
  //   - Discount     → /Lobby/gatewayAPI/verification/getInfo + /loginSuccessResponse
  //   - Hapoalim     → /authenticate/init (NOT /authentication/)
  //   - Max          → /api/login/login
  //   - VisaCal      → /col-rest/calconnect/authentication/login
  // Each pattern is anchored on a path segment (slashes around literal)
  // so they cannot collide with substrings inside query params or paths
  // that happen to contain the same word.
  auth: [
    /\/authentication\/login/i,
    /\/authentication\//i,
    /\/authenticate\//i,
    /\/auth\/login/i,
    /\/verification\//i,
    /\/loginSuccess/i,
    /\/login\/login/i,
  ],
  pending: [/approvals/i, /getClearanceRequests/i, /FutureTransaction/i],
} satisfies Record<string, RegExp[]>;

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

export type { AccountContainerName } from './ScrapeFieldMappings.js';
export {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS,
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS,
  PIPELINE_WELL_KNOWN_RESPONSE_FIELDS,
  PIPELINE_WELL_KNOWN_TXN_FIELDS,
} from './ScrapeFieldMappings.js';
