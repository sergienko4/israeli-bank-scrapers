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
    // Leumi WCF list endpoint `UC_SO_27_GetBusinessAccountTrx` — the
    // `Trx` abbreviation (not the full `Transactions` word) falls
    // outside `get\w*Transactions`, so it needs its own pattern. The
    // module name is Leumi-specific; no cross-bank overlap.
    /GetBusinessAccountTrx/i,
  ],
  // Negative patterns — URL paths that MATCH the `transactions` list
  // above but actually serve dashboard-PREVIEW / status-page WIDGET
  // data (capped at "latest N" records per card). Backbase-style banks
  // (Amex, Isracard) expose `/ocp/statuspage/...` modules whose
  // endpoint names (`GetLatestTransactions`) match the affirmative
  // pattern but truncate records. Mission M4.F2: live Isracard run
  // `10-05-2026_23355229` lost 17–20 historical txns per card to this
  // 5-record cap. Picker rejects any URL matching one of these so
  // widgets never reach SCRAPE; real per-card APIs (under
  // `/ocp/transactions/...`) keep passing. Pure path-segment match —
  // bank-agnostic; `/statuspage/` is the SPA module name, not a bank
  // identity.
  transactionWidgets: [/\/statuspage\//i],
  /** Legacy URL extensions / handlers we don't support. `.ashx` is the
   *  classic ASP.NET handler suffix (Amex's `ProxyRequestHandler.ashx`
   *  legacy auth tier) — every migrated bank uses modern POST/GET
   *  endpoints, never `.ashx`. Drop these at `parseResponse` entry so
   *  they never reach the captured pool and can't be picked by any
   *  downstream tier. Per user direction 15-05-2026: `.ashx` removal
   *  was completed long ago; this is the enforcement gate. */
  unsupported: [/\.ashx(\?|$)/i],
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

/** WellKnown path fragments for the shared "pending / clearance-requests"
 *  API on the same card-family backbone as {@link PIPELINE_WELL_KNOWN_BILLING}.
 *  Used by {@link resolvePendingUrl} when no pending URL was captured —
 *  combined with the discovered API origin so no hostname is hardcoded. */
export const PIPELINE_WELL_KNOWN_PENDING = {
  /** API prefix under the bank's origin (shared with billing). */
  apiPrefix: '/Transactions/api',
  /** Parent path segment of the pending-transactions API. */
  pathFragment: 'approvals',
  /** Leaf action returning the pending/clearance request list. */
  actionName: 'getClearanceRequests',
} as const;

/** WellKnown header name patterns for network discovery. */
export const PIPELINE_WELL_KNOWN_HEADERS = {
  /** Request header names that carry the API origin. */
  origin: ['origin', 'referer'],
  /** Narrow Origin-key set for `spaHasAny` guards (case-insensitive).
   *  Separate from `origin` (which is the broader DISCOVERY fallback
   *  chain) because using `origin` here would also match a captured
   *  `referer` on `spaBase` and incorrectly suppress the bank-Origin
   *  fallback. See `setOriginAndReferer` in DiscoveryHeaders.ts. */
  originKey: ['origin'],
  /** Request header names that carry the SPA page Referer. Separate
   *  from `origin` because the Referer guard in `buildDiscoveredHeaders`
   *  must only check the captured `referer` value (the bare-origin
   *  fallback fires when SPA didn't send one), independent of the
   *  origin-discovery lookup. */
  referer: ['referer'],
  /** Request header names that carry a site/session ID. */
  siteId: ['x-site-id', 'x-session-id'],
  /** Headers that `fetch()` MUST own (forbidden / browser-managed)
   *  or that this module sets from its own discovery layers. Only
   *  these are dropped from `extractSpaHeaders`'s output — everything
   *  else the SPA sent (Accept, Accept-Language, Cache-Control,
   *  Pragma, Referer, Content-Type, User-Agent, X-* custom headers)
   *  propagates verbatim so SCRAPE.ACTION replays the exact request
   *  shape the bank's API expects.
   *
   *  Excluded reasons:
   *  - cookie / host / content-length / connection / transfer-
   *    encoding: forbidden header names in fetch (browser sets).
   *  - accept-encoding / upgrade-insecure-requests: browser-managed
   *    transport hints.
   *  - sec-ch-ua* / sec-fetch-*: client hints / origin policy
   *    fingerprint, browser-controlled.
   *  - origin: forbidden header name; bank-specific value injected
   *    by `discoverHeaderValue(ORIGIN_HEADERS)` separately.
   *  - authorization: bank-specific value injected by `cachedAuth`
   *    separately.
   *
   *  Live evidence (15-05-2026): Hapoalim needs full-path Referer +
   *  exact charset Content-Type; VisaCal needs Accept / Accept-
   *  Language present (their API rejects requests missing these as
   *  401 Unauthorized after the body parses). Filtering these out
   *  caused VisaCal regression in run `13272956` — the trim below
   *  restores them. */
  browserStandard: new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'transfer-encoding',
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
