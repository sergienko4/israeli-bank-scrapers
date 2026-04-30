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

/** Captured URL string (Rule #15 alias). */
type CapturedUrl = string;
/** Whether the URL's value matched a YYYYMMDD literal. */
type IsYmdShape = boolean;
/** Number of params we rewrote. */
type SwapCount = number;
/** Sentinel used when the captured param had no value to probe. */
const NO_PROBE = 'NO_PROBE';
/** Bundled outcome of the patch operation. */
interface IPatchOutcome {
  readonly url: CapturedUrl;
  readonly swapped: SwapCount;
}
/** URL query-param key name. */
type ParamKey = string;
/** Formatted date literal (YYYYMMDD or ISO). */
type FormattedDate = string;

/** Bundled context for swapping a single URL param. */
interface ISwapCtx {
  readonly params: URLSearchParams;
  readonly key: ParamKey;
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
function isYmdShape(raw: string): IsYmdShape {
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
function formatLikeProbe(when: Date, probe: FormattedDate): FormattedDate {
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
function readProbe(params: URLSearchParams, key: ParamKey): FormattedDate {
  const raw = params.get(key);
  if (raw === null) return NO_PROBE;
  return raw;
}

/**
 * Swap a single param if its key is in the WK from/to alias set.
 * @param ctx - Bundled swap context.
 * @returns 1 when swapped, 0 otherwise.
 */
function swapOneParam(ctx: ISwapCtx): SwapCount {
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
function safeParseUrl(input: CapturedUrl): URL | false {
  try {
    return new URL(input);
  } catch {
    return false;
  }
}

/**
 * Rewrite WK-known date params on a URL. Pass-through on parse error
 * or when no matching params present.
 * @param input - Captured URL (POST or GET).
 * @param fromDate - Start of range (options.startDate).
 * @param toDate - End of range (today).
 * @returns Patch outcome with the (possibly mutated) URL + swap count.
 */
function patchUrl(input: CapturedUrl, fromDate: Date, toDate: Date): IPatchOutcome {
  const parsed = safeParseUrl(input);
  if (parsed === false) return { url: input, swapped: 0 };
  let total = 0;
  const keyIter = parsed.searchParams.keys();
  const keys = Array.from(keyIter);
  for (const key of keys) {
    total += swapOneParam({ params: parsed.searchParams, key, fromDate, toDate });
  }
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
export function applyDateRangeToUrl(input: CapturedUrl, fromDate: Date, toDate: Date): CapturedUrl {
  const outcome = patchUrl(input, fromDate, toDate);
  return outcome.url;
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
  input: CapturedUrl,
  fromDate: Date,
  toDate: Date,
): IPatchOutcome {
  return patchUrl(input, fromDate, toDate);
}
