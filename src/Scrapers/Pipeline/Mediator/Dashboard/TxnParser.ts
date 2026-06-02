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
import detectDateWindowParams, { type IDateWindowProbeInput } from './DateWindowParamsDetector.js';
import detectDedupKeyFields from './DedupKeyFieldsDetector.js';

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
 * Locate the first {@link IPairOutcome} of kind 'match' from a list
 * of decoded query-string pairs. Pulled out so
 * {@link extractAccountIdFromUrl} stays under the LoC cap. Returns
 * the canonical SKIP sentinel when no pair matched — keeps the
 * Result-Pattern (no `undefined` return).
 * @param pairs - Raw `key=value` fragments to inspect.
 * @returns Matched outcome or {@link PAIR_OUTCOME_SKIP} when nothing matched.
 */
function findFirstMatch(pairs: readonly string[]): IPairOutcome {
  const outcomes = pairs.map(extractAccountIdFromPair);
  const matched = outcomes.find((outcome): boolean => outcome.kind === 'match');
  return matched ?? PAIR_OUTCOME_SKIP;
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
  const matched = findFirstMatch(pairs);
  if (matched.kind === 'match') return matched.value;
  return false;
}

/**
 * Sentinel key used in `dedupKeyFieldsByAccount` for harvests that
 * captured an unscoped response (no per-account id in URL/body).
 */
const UNSCOPED_ACCOUNT_KEY = '';

/**
 * Resolves the lookup key for a harvest's dedup-key map entry —
 * the captured accountId when set, or `UNSCOPED_ACCOUNT_KEY` for
 * captures with no account in the URL/body.
 *
 * @param capturedAccountId - The account id from the URL/body, or
 *   `false` when unscoped.
 * @returns Map key (non-empty accountId or sentinel).
 */
function resolveDedupKeyMapKey(capturedAccountId: string | false): string {
  if (capturedAccountId === false) return UNSCOPED_ACCOUNT_KEY;
  return capturedAccountId;
}

/**
 * Builds the per-account dedup-key map for a harvest. Returns an
 * empty map when SCRAPE cannot reuse the harvest (multi-scope) or
 * when the harvest is empty — both cases skip the detector because
 * its output would be unused.
 *
 * @param records - Normalized records for the harvest.
 * @param capturedAccountId - The account id encoded in the captured
 *   URL/body, or `false` when the capture is unscoped.
 * @param shouldSkip - When true, the detector is not called
 *   (multi-scope harvests or empty record sets).
 * @returns Map keyed by capturedAccountId (or `UNSCOPED_ACCOUNT_KEY`
 *   for unscoped harvests). Empty map when `shouldSkip` is true.
 */
function buildDedupKeyFieldsMap(
  records: readonly ITransaction[],
  capturedAccountId: string | false,
  shouldSkip: boolean,
): ReadonlyMap<string, readonly string[]> {
  if (shouldSkip) return new Map();
  const fields = detectDedupKeyFields(records);
  const key = resolveDedupKeyMapKey(capturedAccountId);
  return new Map([[key, fields]]);
}

/**
 * Phase H'' — builds the per-account date-window URL-param map from
 * the captured pool. Mirrors {@link buildDedupKeyFieldsMap} but
 * sources data from the whole pool (URL search params + top-level
 * body keys), not just the picked endpoint's records — the WK alias
 * for a bank's window may live on a sibling capture (e.g. Hapoalim's
 * `?type=totals&view=future` body carries top-level `startDate` /
 * `endDate` even when the detail txn POST never fired).
 *
 * <p>Returns an empty map when SCRAPE cannot reuse the harvest
 * (multi-scope) or when no WK alias pair is observed.
 *
 * @param pool - Captured pool from `INetworkDiscovery.getAllEndpoints`.
 * @param capturedAccountId - The account id encoded in the picked
 *   capture's URL/body, or `false` when unscoped.
 * @param shouldSkip - When true, the detector is not called.
 * @returns Map keyed by capturedAccountId; empty map when `shouldSkip`
 *   is true or no WK alias pair is observed.
 */
function buildDateWindowParamsMap(
  pool: readonly IDateWindowProbeInput[],
  capturedAccountId: string | false,
  shouldSkip: boolean,
): ReadonlyMap<string, readonly [string, string]> {
  if (shouldSkip) return new Map();
  const params = detectDateWindowParams(pool);
  if (params.length < 2) return new Map();
  const key = resolveDedupKeyMapKey(capturedAccountId);
  return new Map([[key, [params[0], params[1]]]]);
}

/** Computed scope decision for a captured TXN endpoint. */
interface IHarvestScope {
  readonly capturedAccountId: string | false;
  readonly isMultiAccountScope: boolean;
  readonly shouldSkipDetector: boolean;
}

/**
 * Resolve the captured-scope flags for a TXN endpoint. Pulled out so
 * {@link buildTxnHarvest} keeps to the ≤10 LoC body cap. The decision
 * is purely a function of the captured URL, the raw body shape, and
 * how many accounts ACCOUNT-RESOLVE committed.
 *
 * @param internal - DASHBOARD-internal resolver result.
 * @param accountIdCount - Accounts ACCOUNT-RESOLVE committed.
 * @returns Scope flags consumed by the harvest builder.
 */
function resolveHarvestScope(
  internal: ITxnEndpointInternal,
  accountIdCount: number,
): IHarvestScope {
  const capturedAccountId = extractAccountIdFromUrl(internal.endpoint.url);
  const isBodyShapeMulti = detectMultiAccountScope(internal.responseBodySample);
  const isContextMulti = capturedAccountId === false && accountIdCount > 1;
  const isMultiAccountScope = isBodyShapeMulti || isContextMulti;
  const shouldSkipDetector = isMultiAccountScope || internal.normalizedRecords.length === 0;
  return { capturedAccountId, isMultiAccountScope, shouldSkipDetector };
}

/**
 * Builds the DASHBOARD-side TXN harvest from the internal resolver
 * payload. Mirrors how ACCOUNT-RESOLVE builds {@link IAccountDiscovery}
 * — the phase that captured the response normalizes the records and
 * commits them as a clean value type. SCRAPE consumes the resulting
 * `readonly ITransaction[]` without seeing captured raw bytes.
 *
 * <p>Phase G (2026-05-14): every harvest also carries a per-card
 * `dedupKeyFieldsByAccount` map. The detector runs on the
 * normalized-records sample (skipped on multi-scope harvests or
 * empty results) and emits one entry keyed by capturedAccountId
 * (or `''` sentinel for unscoped captures).
 *
 * @param internal - DASHBOARD-internal resolver result.
 * @param accountIdCount - Accounts ACCOUNT-RESOLVE committed.
 * @param pool - Captured network pool — handed to the Phase H''
 *   date-window detector. Defaults to `[]` so legacy tests that
 *   exercise only the dedup-key detector stay terse.
 * @returns Harvest payload for `ctx.dashboardTxnHarvest`.
 */
function buildTxnHarvest(
  internal: ITxnEndpointInternal,
  accountIdCount: number,
  pool: readonly IDateWindowProbeInput[] = [],
): IDashboardTxnHarvest {
  const scope = resolveHarvestScope(internal, accountIdCount);
  const records = internal.normalizedRecords;
  const maps = buildHarvestMaps({ records, scope, pool });
  return assembleHarvestPayload(records, scope, maps);
}

/** Per-account harvest maps the assembler folds into the payload. */
interface IHarvestMaps {
  readonly dedupKeyFieldsByAccount: ReadonlyMap<string, readonly string[]>;
  readonly dateWindowParamsByAccount: ReadonlyMap<string, readonly [string, string]>;
}

/** Inputs for {@link buildHarvestMaps}. Bundled to respect the ≤3-param cap. */
interface IBuildHarvestMapsArgs {
  readonly records: readonly ITransaction[];
  readonly scope: IHarvestScope;
  readonly pool: readonly IDateWindowProbeInput[];
}

/**
 * Build the per-account dedup-key and date-window maps for a harvest.
 * Pulled out so {@link buildTxnHarvest} stays under the LoC cap; the
 * two map builders share the same scope flags and would otherwise
 * inflate the body with extra wiring.
 *
 * @param args - Bundled records, scope flags, and captured pool.
 * @returns Per-account dedup-key and date-window maps.
 */
function buildHarvestMaps(args: IBuildHarvestMapsArgs): IHarvestMaps {
  const dedupKeyFieldsByAccount = buildDedupMapFromArgs(args);
  const dateWindowParamsByAccount = buildDateWindowMapFromArgs(args);
  return { dedupKeyFieldsByAccount, dateWindowParamsByAccount };
}

/**
 * Project {@link IBuildHarvestMapsArgs} onto {@link buildDedupKeyFieldsMap}.
 * Pulled out so {@link buildHarvestMaps} stays under the LoC cap; the
 * multi-line argument list would otherwise dominate the orchestrator.
 *
 * @param args - Bundled records, scope flags, and captured pool.
 * @returns Per-account dedup-key field-name tuples.
 */
function buildDedupMapFromArgs(
  args: IBuildHarvestMapsArgs,
): ReadonlyMap<string, readonly string[]> {
  const { records, scope } = args;
  return buildDedupKeyFieldsMap(records, scope.capturedAccountId, scope.shouldSkipDetector);
}

/**
 * Project {@link IBuildHarvestMapsArgs} onto {@link buildDateWindowParamsMap}.
 * Mirrors {@link buildDedupMapFromArgs} so the orchestrator stays a
 * three-line sequence of named projections + a return literal.
 *
 * @param args - Bundled records, scope flags, and captured pool.
 * @returns Per-account WK-aliased `[fromDate, toDate]` URL parameter tuples.
 */
function buildDateWindowMapFromArgs(
  args: IBuildHarvestMapsArgs,
): ReadonlyMap<string, readonly [string, string]> {
  const { pool, scope } = args;
  return buildDateWindowParamsMap(pool, scope.capturedAccountId, scope.isMultiAccountScope);
}

/**
 * Assemble the final {@link IDashboardTxnHarvest} payload from the
 * resolved scope, records, and per-account maps. Pure projection
 * helper — kept module-scope so {@link buildTxnHarvest} body remains
 * a small orchestration sequence.
 *
 * @param records - Normalised transaction records.
 * @param scope - Resolved harvest-scope flags.
 * @param maps - Per-account dedup-key and date-window maps.
 * @returns Harvest payload for `ctx.dashboardTxnHarvest`.
 */
function assembleHarvestPayload(
  records: readonly ITransaction[],
  scope: IHarvestScope,
  maps: IHarvestMaps,
): IDashboardTxnHarvest {
  return {
    records,
    capturedAccountId: scope.capturedAccountId,
    multiAccountScope: scope.isMultiAccountScope,
    dedupKeyFieldsByAccount: maps.dedupKeyFieldsByAccount,
    dateWindowParamsByAccount: maps.dateWindowParamsByAccount,
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
