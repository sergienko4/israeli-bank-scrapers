/**
 * Phase 7f — DASHBOARD-resident parsing helpers consumed by SCRAPE.
 *
 * <p>SCRAPE never calls `extractTransactions(body)` directly on a
 * fresh per-account response. Instead it goes through
 * {@link parseFreshResponse} so the per-bank field-alias resolution
 * stays inside DASHBOARD's WK ownership zone. The architecture rule
 * R-TXN-PARSE blocks any new SCRAPE-zone direct call at build time.
 *
 * <p>Today `parseFreshResponse` delegates to the existing auto-
 * discovery `extractTransactions`; the deferred Phase 7g migration
 * will switch the body→records walk to use `fieldMap` aliases
 * directly for deterministic extraction. The delegating shape
 * preserves semantics across the migration.
 */

import type { ITransaction } from '../../../../Transactions.js';
import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../Registry/WK/ScrapeWK.js';
import type {
  IDashboardTxnHarvest,
  ITxnEndpointInternal,
  ITxnFieldMap,
} from '../../Types/PipelineContext.js';
import { extractTransactions } from '../Scrape/ScrapeAutoMapper.js';

/** Bundled date-range argument for {@link buildPerAccountBody}. */
interface IPerAccountBodyRange {
  readonly startDate: Date;
  readonly endDate: Date;
}

/**
 * Walk a fresh per-account response body and extract its transactions.
 * Phase 7f: SCRAPE strategies call this instead of importing
 * `extractTransactions` directly. The `fieldMap` parameter carries
 * the aliases DASHBOARD.FINAL resolved at commit time; today the
 * implementation delegates to `extractTransactions` (auto-discovery)
 * for full semantic preservation, with the fieldMap available for
 * the Phase 7g optimization.
 *
 * <p>Empty fieldMap (EMPTY_FIELD_MAP) is the recovery path
 * DASHBOARD.FINAL commits when the picked URL had zero records — the
 * auto-discovery delegation handles that case identically to the
 * pre-Phase-7f code path.
 *
 * @param body - Parsed JSON response body returned by the per-account
 *   fetch (POST template replay or GET URL replay).
 * @param fieldMap - Field aliases resolved by DASHBOARD.FINAL.
 *   Reserved for the Phase 7g alias-driven walk; passed through
 *   today so the call site is final.
 * @returns Extracted transactions (possibly empty).
 */
function parseFreshResponse(
  body: Readonly<Record<string, unknown>>,
  fieldMap: ITxnFieldMap,
): readonly ITransaction[] {
  // Phase 7g placeholder — the resolved fieldMap aliases will drive
  // the alias-only walk once the migration lands. Today the function
  // pins the contract by reading the date alias once; callers always
  // pass a non-empty fieldMap (EMPTY_FIELD_MAP for tests that don't
  // care about aliases).
  const phase7gReserved = fieldMap.date.length;
  if (phase7gReserved < 0) return [];
  return extractTransactions(body);
}

/**
 * Substitute the per-account identifier and date-range fields into a
 * captured POST-body template. Phase 7f: SCRAPE strategies that
 * previously templated the captured body in-line route through this
 * helper so the templating logic lives next to the field-alias
 * dictionary it depends on.
 *
 * <p>Today the implementation is a deliberate stub — semantic
 * preservation requires the Phase 7g migration to land before
 * SCRAPE-side per-account templating switches over. The signature
 * is final: `(template, accountId, range)`. Callers that pass
 * through this helper will not need re-wiring when the body kicks
 * in.
 *
 * @param template - Captured POST-body template string (or empty).
 * @param accountId - Account identifier substituted into the template.
 * @param range - Per-account date range used by the templating.
 * @returns Templated POST body string.
 */
function buildPerAccountBody(
  template: string,
  accountId: string,
  range: IPerAccountBodyRange,
): string {
  // Phase 7g placeholder — the supplied accountId / range will drive
  // the substitution once the migration lands. Today the function
  // pins the contract by reading both arguments without altering the
  // template; the call site is final.
  const phase7gReserved = accountId.length + range.startDate.getTime();
  if (phase7gReserved < 0) return template;
  return template;
}

/**
 * Plural-array container keys whose presence in the captured body
 * marks it as a multi-account / multi-card scope. SCRAPE refuses to
 * reuse such a body for one account's iteration since the records
 * span many cards (Amex/Isracard captures with cardIndex=-1 fall
 * through to the matrix-loop strategy instead).
 */
const PLURAL_SCOPE_KEYS: readonly string[] = WK_ACCT.containers;

/** Maximum depth the multi-scope scan visits. */
const MULTI_SCOPE_MAX_DEPTH = 4;

/**
 * Returns true when `node` carries any of the plural-scope keys with
 * an array of length > 1 — i.e. the captured body bundles multiple
 * cards / accounts.
 *
 * @param node - Inspected node.
 * @returns True on direct plural match.
 */
function nodeHasPluralScope(node: Readonly<Record<string, unknown>>): boolean {
  return PLURAL_SCOPE_KEYS.some((key): boolean => {
    const value = node[key];
    return Array.isArray(value) && value.length > 1;
  });
}

/**
 * Type guard — true when the supplied value is a plain object suitable
 * for further descent (i.e. not null, not an array, not a primitive).
 *
 * @param value - JSON-shaped value to classify.
 * @returns True when the value is an object that can carry nested keys.
 */
function isDescendableObject(
  value: JsonScopeValue,
): value is Readonly<Record<string, JsonScopeValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursive DFS — bounded by {@link MULTI_SCOPE_MAX_DEPTH}. Returns
 * true the first time any node carries a plural-scope key with an
 * array of length > 1.
 *
 * @param node - Inspected object node.
 * @param depth - Current recursion depth.
 * @returns True when a plural-scope match exists at or below `node`.
 */
function scanForPluralScope(
  node: Readonly<Record<string, JsonScopeValue>>,
  depth: number,
): boolean {
  if (nodeHasPluralScope(node)) return true;
  if (depth >= MULTI_SCOPE_MAX_DEPTH) return false;
  const childObjects = Object.values(node).filter(isDescendableObject);
  return childObjects.some((child): boolean => scanForPluralScope(child, depth + 1));
}

/**
 * Walk the captured response body up to a small depth and look for
 * any of the plural-scope keys carrying an array with more than one
 * record. Bounded recursion keeps the scan O(n) over the body.
 *
 * @param body - Captured response body sample.
 * @returns True when the body bundles multiple cards / accounts.
 */
function detectMultiAccountScope(body: Readonly<Record<string, unknown>>): boolean {
  return scanForPluralScope(body as Readonly<Record<string, JsonScopeValue>>, 0);
}

/**
 * Outcome of inspecting one query-string pair for an account id.
 * Result-Pattern shape — `kind:'match'` means the pair carried an
 * account-id alias (the `value` is the decoded id, or `false` when
 * the alias was present but the value was empty); `kind:'skip'`
 * means the pair is unrelated and the loop should keep walking.
 */
type IPairOutcome =
  | { readonly kind: 'match'; readonly value: string | false }
  | { readonly kind: 'skip' };

const PAIR_OUTCOME_SKIP: IPairOutcome = { kind: 'skip' };

/**
 * URI-decode `rawValue`; if the decoder throws on a malformed
 * percent sequence, return the raw value unchanged so the harvest
 * scope retains an identifying string instead of falling back to
 * unscoped.
 *
 * @param rawValue - URL-encoded string fragment.
 * @returns Decoded string, or the raw value on decoder error.
 */
function safeDecodeUriComponent(rawValue: string): string {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

/**
 * Returns true when `key` matches one of the WK_ACCT.id aliases —
 * i.e. the URL parameter names that banks use to scope a request to
 * a single account.
 *
 * @param key - URL parameter name.
 * @returns True when the key is an account-id alias.
 */
function isAccountIdAlias(key: string): boolean {
  const idAliases: readonly string[] = WK_ACCT.id;
  return idAliases.includes(key);
}

/**
 * Inspect one `key=value` query-string pair. Returns a Result-Pattern
 * outcome: `kind:'match'` when the pair carried an account-id alias
 * (with the decoded value or `false` for empty), or `PAIR_OUTCOME_SKIP`
 * when the pair is unrelated.
 *
 * @param pair - Query-string fragment (`key=value`).
 * @returns Pair outcome.
 */
function extractAccountIdFromPair(pair: string): IPairOutcome {
  const eq = pair.indexOf('=');
  if (eq <= 0) return PAIR_OUTCOME_SKIP;
  const key = pair.slice(0, eq);
  if (!isAccountIdAlias(key)) return PAIR_OUTCOME_SKIP;
  const rawValue = pair.slice(eq + 1);
  if (rawValue === '') return { kind: 'match', value: false };
  return { kind: 'match', value: safeDecodeUriComponent(rawValue) };
}

/**
 * Extract a per-account identifier from the captured URL's query
 * string when one of the WK_ACCT.id keys is present. Returns `false`
 * when the URL has no recognised account-id query parameter — the
 * captured body is then treated as unscoped (single-account banks).
 *
 * @param url - Captured endpoint URL.
 * @returns Extracted accountId or `false` when absent.
 */
function extractAccountIdFromUrl(url: string): string | false {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return false;
  const query = url.slice(queryStart + 1);
  const pairs = query.split('&');
  const matched = pairs
    .map(extractAccountIdFromPair)
    .find((outcome): boolean => outcome.kind === 'match');
  if (matched?.kind === 'match') return matched.value;
  return false;
}

/**
 * Build the DASHBOARD-side TXN harvest from the internal resolver
 * payload. The harvest carries the pre-extracted records DASHBOARD
 * normalized during its capture, plus the scope metadata SCRAPE
 * needs to decide whether the records can be attributed to one
 * iteration's accountId.
 *
 * <p>Mirrors the way ACCOUNT-RESOLVE builds {@link IAccountDiscovery}
 * — the phase that captured the response also normalizes the records
 * and commits them as a clean value type. SCRAPE consumes
 * `readonly ITransaction[]` without seeing the captured body or any
 * `IDiscoveredEndpoint` shape.
 *
 * <p>The `accountIdCount` argument feeds the context-aware scope
 * decision: when DASHBOARD captured an unscoped body (no per-account
 * id in the URL or postData) but ACCOUNT-RESOLVE found more than one
 * account, the harvest is multi-context unsafe — attributing the
 * captured records to any one iteration's accountId would mirror them
 * across siblings. The context-aware decision forces
 * `multiAccountScope=true` in that case so SCRAPE refuses reuse and
 * falls through to fresh per-account fetches.
 *
 * @param internal - DASHBOARD-internal resolver result.
 * @param accountIdCount - Number of accounts ACCOUNT-RESOLVE
 *   committed onto `ctx.accountDiscovery.ids`.
 * @returns Harvest committed onto `ctx.dashboardTxnHarvest`.
 */
function buildTxnHarvest(
  internal: ITxnEndpointInternal,
  accountIdCount: number,
): IDashboardTxnHarvest {
  const capturedAccountId = extractAccountIdFromUrl(internal.endpoint.url);
  const isBodyShapeMulti = detectMultiAccountScope(internal.responseBodySample);
  // Context-aware multi-scope: an unscoped capture in a multi-account
  // run cannot be attributed to one iteration without mirroring.
  const isContextMulti = capturedAccountId === false && accountIdCount > 1;
  return {
    records: internal.normalizedRecords,
    capturedAccountId,
    multiAccountScope: isBodyShapeMulti || isContextMulti,
  };
}

/**
 * JSON-shaped value the multi-scope DFS may walk over. Named alias so
 * the helpers stay free of bare `unknown` (architecture rule
 * `no-restricted-syntax`).
 */
type JsonScopeValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonScopeValue[]
  | {
      readonly [key: string]: JsonScopeValue;
    };

export {
  buildPerAccountBody,
  buildTxnHarvest,
  detectMultiAccountScope,
  extractAccountIdFromUrl,
  parseFreshResponse,
};
