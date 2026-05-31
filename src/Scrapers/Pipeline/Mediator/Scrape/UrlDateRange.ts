/**
 * Generic URL query-param date-range patcher.
 * Walks a URL's searchParams and rewrites any param whose key is in
 * WK.fromDate / WK.toDate. Format-preserving — emits the same shape
 * as the original captured URL (typically YYYYMMDD).
 *
 * Used by scrape paths to honor options.startDate when the bank's
 * range lives in the URL query string (Hapoalim, Discount-style GETs)
 * rather than the POST body.
 *
 * Zero bank-specific code. No hardcoded URL paths.
 */

import moment from 'moment';

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../Types/Brand.js';

/** URL with date-range params rewritten. */
type DateRangeAppliedUrl = Brand<string, 'DateRangeAppliedUrl'>;

/** Sentinel used when the captured param had no value to probe. */
const NO_PROBE = 'NO_PROBE';
/** Bundled outcome of the patch operation. */
interface IPatchOutcome {
  readonly url: string;
  readonly swapped: number;
}

/** Bundled context for swapping a single URL param. */
interface ISwapCtx {
  readonly params: URLSearchParams;
  readonly key: string;
  readonly fromDate: Date;
  readonly toDate: Date;
}

const FROM_KEYS = new Set<string>(WK.fromDate);
const TO_KEYS = new Set<string>(WK.toDate);
const YMD_PATTERN = /^\d{8}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/**
 * Detect whether the existing param value looks like YYYYMMDD.
 * Used to preserve the bank's expected format on output.
 * @param raw - Captured param value.
 * @returns True when raw is exactly 8 digits.
 */
function isYmdShape(raw: string): boolean {
  return YMD_PATTERN.test(raw);
}

/**
 * Format a date for the captured URL, preserving the original shape.
 * Defaults to YYYYMMDD which matches every observed bank URL today;
 * falls back to ISO when the captured value was clearly ISO.
 * @param when - Target Date.
 * @param probe - The original captured value (used to detect format).
 * @returns Formatted date string.
 */
function formatLikeProbe(when: Date, probe: string): string {
  if (isYmdShape(probe)) return moment(when).format('YYYYMMDD');
  if (ISO_DATE_PATTERN.test(probe)) return moment(when).format('YYYY-MM-DD');
  return moment(when).format('YYYYMMDD');
}

/**
 * Read the existing param value or NO_PROBE when absent.
 * @param params - URL search params.
 * @param key - Param key.
 * @returns Existing value or NO_PROBE sentinel.
 */
function readProbe(params: URLSearchParams, key: string): string {
  const raw = params.get(key);
  if (raw === null) return NO_PROBE;
  return raw;
}

/**
 * Apply a date value to a URL param, preserving the captured format.
 * Helper for {@link swapOneParam} — pulled out so the orchestrator
 * fits the 10-LoC cap (Phase 8.5b §12 canonical-10 drain).
 * @param params - URL search params (mutated in-place).
 * @param key - Param key to overwrite.
 * @param when - Date to format and set.
 * @returns Always 1 (caller treats as swap count).
 */
function setDateParam(params: URLSearchParams, key: string, when: Date): 1 {
  const probe = readProbe(params, key);
  const formatted = formatLikeProbe(when, probe);
  params.set(key, formatted);
  return 1;
}

/**
 * Swap a single param if its key is in the WK from/to alias set.
 * @param ctx - Bundled swap context.
 * @returns 1 when swapped, 0 otherwise.
 */
function swapOneParam(ctx: ISwapCtx): number {
  if (FROM_KEYS.has(ctx.key)) return setDateParam(ctx.params, ctx.key, ctx.fromDate);
  if (TO_KEYS.has(ctx.key)) return setDateParam(ctx.params, ctx.key, ctx.toDate);
  return 0;
}

/**
 * Safe-parse a URL, returning false when input is malformed.
 * @param input - Candidate URL string.
 * @returns Parsed URL or false.
 */
function safeParseUrl(input: string): URL | false {
  try {
    return new URL(input);
  } catch {
    return false;
  }
}

/** Bundled date range shared by every patch context. */
interface IDateRange {
  readonly fromDate: Date;
  readonly toDate: Date;
}

/**
 * Phase H'' (2026-05-15) — bundled date range with the detector's
 * WK-aliased `[fromAlias, toAlias]` tuple. Drives the rescue APPEND
 * branch in {@link patchUrl} so dormant-account dashboards where the
 * SPA omits the txn-range params still produce a date-window-aware
 * URL on replay.
 */
interface IDateRangeWithWindow extends IDateRange {
  readonly windowParams: readonly string[];
}

/**
 * True when the URL's search params already carry both a WK fromDate
 * alias AND a WK toDate alias (any names from {@link WK.fromDate} /
 * {@link WK.toDate}). Used by {@link appendMissingAliases} to skip
 * the append step when {@link applyDateRangeToUrl} already
 * substituted the URL's existing aliases — otherwise appending the
 * detector's tuple aliases produces conflicting param schemes that
 * the bank may reject with 302 redirect.
 *
 * <p>Live regression evidence — Hapoalim run `15-05-2026_11414346`:
 * URL had `retrievalStartDate`/`retrievalEndDate` (WK aliases). The
 * detector emitted tuple `['startDate', 'endDate']` (from a sibling
 * `?type=totals&view=future` body). Appending `startDate`/`endDate`
 * on top of the substituted `retrievalStartDate`/`retrievalEndDate`
 * produced both alias schemes simultaneously → bank 302'd → SCRAPE
 * extracted 0 txns.
 *
 * @param params - URL search params to inspect.
 * @returns True when both a WK fromDate alias and a WK toDate alias
 *   are present (in any of their WK names).
 */
function urlAlreadyHasWkRange(params: URLSearchParams): boolean {
  const keyIter = params.keys();
  const keys = Array.from(keyIter);
  const hasFrom = keys.some((key): boolean => FROM_KEYS.has(key));
  if (!hasFrom) return false;
  const hasTo = keys.some((key): boolean => TO_KEYS.has(key));
  return hasTo;
}

/** Bundled target for {@link appendMissingAliases} — keeps the orchestrator under the 10-LoC cap. */
interface IAppendTarget {
  readonly params: URLSearchParams;
  readonly range: IDateRange;
}

/**
 * Set a URL alias to the YYYYMMDD-formatted date value when missing.
 * Helper for {@link appendMissingAliases}.
 * @param params - URL search params (mutated in-place).
 * @param alias - Alias key (e.g. `fromDate`).
 * @param date - Date value to format.
 * @returns 1 if appended, 0 if already present.
 */
function appendAliasIfMissing(params: URLSearchParams, alias: string, date: Date): number {
  if (params.has(alias)) return 0;
  const formatted = moment(date).format('YYYYMMDD');
  params.set(alias, formatted);
  return 1;
}

/**
 * Phase H'' (2026-05-15): when the detector emitted a non-empty
 * WK-aliased tuple but neither alias is present in the captured URL,
 * APPEND both with options-driven values. Pass-through when either
 * alias is empty-string or already present in the URL, or when the
 * URL already carries any WK fromDate + any WK toDate alias (which
 * means {@link applyDateRangeToUrl} already substituted them — see
 * {@link urlAlreadyHasWkRange}).
 * @param target - Bundled params + range (mutated in-place).
 * @param tuple - Detector tuple `[fromAlias, toAlias]`.
 * @returns Count of newly appended params (0, 1, or 2).
 */
function appendMissingAliases(target: IAppendTarget, tuple: readonly string[]): number {
  if (tuple.length < 2) return 0;
  const [fromAlias, toAlias] = tuple;
  if (fromAlias === '' || toAlias === '') return 0;
  if (urlAlreadyHasWkRange(target.params)) return 0;
  const fromCount = appendAliasIfMissing(target.params, fromAlias, target.range.fromDate);
  const toCount = appendAliasIfMissing(target.params, toAlias, target.range.toDate);
  return fromCount + toCount;
}

/** Bundled context for {@link patchUrl}. */
interface IPatchCtx extends IDateRangeWithWindow {
  readonly input: string;
}

/**
 * Walk every search-param key and swap WK fromDate/toDate aliases.
 * Helper for {@link patchUrl}.
 * @param params - URL search params (mutated in-place).
 * @param fromDate - Range start.
 * @param toDate - Range end.
 * @returns Number of swapped params.
 */
function swapAllParams(params: URLSearchParams, fromDate: Date, toDate: Date): number {
  let total = 0;
  const keyIter = params.keys();
  const keys = Array.from(keyIter);
  for (const key of keys) {
    total += swapOneParam({ params, key, fromDate, toDate });
  }
  return total;
}

/**
 * Rewrite WK-known date params on a URL. Pass-through on parse error
 * or when no matching params present. When `windowParams` carries a
 * non-empty `[fromAlias, toAlias]` tuple emitted by the date-window
 * detector, also APPEND those aliases if missing — covers Hapoalim
 * dormant-account URLs where the SPA omits the txn-range params.
 * @param ctx - Bundled patch context.
 * @returns Patch outcome with the (possibly mutated) URL + swap count.
 */
function patchUrl(ctx: IPatchCtx): IPatchOutcome {
  const parsed = safeParseUrl(ctx.input);
  if (parsed === false) return { url: ctx.input, swapped: 0 };
  const range: IDateRange = { fromDate: ctx.fromDate, toDate: ctx.toDate };
  const swapped = swapAllParams(parsed.searchParams, ctx.fromDate, ctx.toDate);
  const appended = appendMissingAliases({ params: parsed.searchParams, range }, ctx.windowParams);
  return { url: parsed.toString(), swapped: swapped + appended };
}

/**
 * Apply a from/to date range to a captured URL using WK aliases.
 * Returns the rewritten URL string. Idempotent and back-compatible:
 * URLs with no matching keys pass through unchanged.
 * @param input - Captured URL.
 * @param fromDate - Range start (Date).
 * @param toDate - Range end (Date).
 * @returns Rewritten URL string.
 */
export function applyDateRangeToUrl(
  input: string,
  fromDate: Date,
  toDate: Date,
): DateRangeAppliedUrl {
  const outcome = patchUrl({ input, fromDate, toDate, windowParams: [] });
  return outcome.url as DateRangeAppliedUrl;
}

/**
 * Variant returning swap count alongside the URL — used by callers
 * that want to log "patched N params".
 * @param input - Captured URL.
 * @param fromDate - Range start.
 * @param toDate - Range end.
 * @returns Bundled outcome.
 */
export function applyDateRangeToUrlWithCount(
  input: string,
  fromDate: Date,
  toDate: Date,
): IPatchOutcome {
  return patchUrl({ input, fromDate, toDate, windowParams: [] });
}

/**
 * Phase H'' (2026-05-15) variant — apply the date range AND APPEND
 * the detector's WK-aliased `[fromAlias, toAlias]` tuple when neither
 * alias is present in the captured URL. Used by SCRAPE strategies
 * after SCRAPE.PRE plucked the tuple from
 * `harvest.dateWindowParamsByAccount`.
 * @param input - Captured URL.
 * @param range - Bundled range with `windowParams` tuple.
 * @returns Rewritten URL string.
 */
export function applyDateRangeAndAppend(
  input: string,
  range: IDateRangeWithWindow,
): DateRangeAppliedUrl {
  const outcome = patchUrl({ ...range, input });
  return outcome.url as DateRangeAppliedUrl;
}

/**
 * Phase H'' (2026-05-15) variant returning swap count — see
 * {@link applyDateRangeAndAppend} for semantics.
 * @param input - Captured URL.
 * @param range - Bundled range with `windowParams` tuple.
 * @returns Bundled outcome.
 */
export function applyDateRangeAndAppendWithCount(
  input: string,
  range: IDateRangeWithWindow,
): IPatchOutcome {
  return patchUrl({ ...range, input });
}
