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
 * Swap a single param if its key is in the WK from/to alias set.
 * @param ctx - Bundled swap context.
 * @returns 1 when swapped, 0 otherwise.
 */
function swapOneParam(ctx: ISwapCtx): number {
  if (FROM_KEYS.has(ctx.key)) {
    const probe = readProbe(ctx.params, ctx.key);
    const formatted = formatLikeProbe(ctx.fromDate, probe);
    ctx.params.set(ctx.key, formatted);
    return 1;
  }
  if (TO_KEYS.has(ctx.key)) {
    const probe = readProbe(ctx.params, ctx.key);
    const formatted = formatLikeProbe(ctx.toDate, probe);
    ctx.params.set(ctx.key, formatted);
    return 1;
  }
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
 * Phase H'' (2026-05-15): when the detector emitted a non-empty
 * WK-aliased tuple but neither alias is present in the captured URL,
 * APPEND both with options-driven values. Pass-through when either
 * alias is empty-string or already present in the URL.
 * @param params - URL search params (mutated in-place).
 * @param tuple - Detector tuple `[fromAlias, toAlias]`.
 * @param range - Bundled date range.
 * @returns Count of newly appended params (0, 1, or 2).
 */
function appendMissingAliases(
  params: URLSearchParams,
  tuple: readonly string[],
  range: IDateRange,
): number {
  if (tuple.length < 2) return 0;
  const [fromAlias, toAlias] = tuple;
  if (fromAlias === '' || toAlias === '') return 0;
  let appended = 0;
  if (!params.has(fromAlias)) {
    const formattedFrom = moment(range.fromDate).format('YYYYMMDD');
    params.set(fromAlias, formattedFrom);
    appended += 1;
  }
  if (!params.has(toAlias)) {
    const formattedTo = moment(range.toDate).format('YYYYMMDD');
    params.set(toAlias, formattedTo);
    appended += 1;
  }
  return appended;
}

/** Bundled context for {@link patchUrl}. */
interface IPatchCtx extends IDateRangeWithWindow {
  readonly input: string;
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
  let total = 0;
  const keyIter = parsed.searchParams.keys();
  const keys = Array.from(keyIter);
  for (const key of keys) {
    total += swapOneParam({
      params: parsed.searchParams,
      key,
      fromDate: ctx.fromDate,
      toDate: ctx.toDate,
    });
  }
  const range: IDateRange = { fromDate: ctx.fromDate, toDate: ctx.toDate };
  total += appendMissingAliases(parsed.searchParams, ctx.windowParams, range);
  return { url: parsed.toString(), swapped: total };
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
