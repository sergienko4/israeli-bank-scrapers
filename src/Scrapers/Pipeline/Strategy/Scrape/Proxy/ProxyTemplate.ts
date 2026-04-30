/**
 * ProxyTemplate — Dynamic Proxy Replay for .ashx-based banks.
 * Builds proxy URLs and injects date parameters without hardcoding bank logic.
 * Rule #11: Generic for any bank that uses a proxy handler with reqName params.
 */

import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';

const LOG = getDebug(import.meta.url);

/** Constructed proxy URL string. */
type ProxyUrl = string;
/** API base URL or null when not configured. */
type ApiBaseUrl = string | null;
/** Proxy reqName (discovered from traffic). */
type ReqName = string;
/** Whether a param key matches a date-related pattern. */
type IsDateKey = boolean;

/** Regex for keys that represent a full date (YYYY-MM-DD format). */
const DATE_KEY_PATTERN = /^(?:billing)?date$/i;
/** Regex for keys that represent a month number. */
const MONTH_KEY_PATTERN = /^month$/i;
/** Regex for keys that represent a year. */
const YEAR_KEY_PATTERN = /^year$/i;

/** The .ashx proxy handler path — shared across Isracard-family banks. */
const PROXY_HANDLER_PATH = '/services/ProxyRequestHandler.ashx';

/**
 * Build a full proxy URL from api.base + reqName + params.
 * @param apiBase - The bank's api.base URL.
 * @param reqName - The proxy request name.
 * @param params - Additional query parameters.
 * @returns Full URL string, or empty string if apiBase is null.
 */
function buildProxyUrl(
  apiBase: ApiBaseUrl,
  reqName: ReqName,
  params: Record<string, string>,
): ProxyUrl {
  if (!apiBase) return '';
  const url = new URL(`${apiBase}${PROXY_HANDLER_PATH}`);
  url.searchParams.set('reqName', reqName);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }
  const fullUrl = url.toString();
  LOG.debug({
    message: `[PROXY] Replaying Proxy: ${maskVisibleText(reqName)}`,
  });
  return fullUrl;
}

/** Raw month number (1-12). */
type RawMonth = number;
/** Zero-padded month or date string. */
type DateStr = string;

/**
 * Format a month number as zero-padded string.
 * @param rawMonth - Month number (1-12).
 * @returns Zero-padded month string.
 */
function padMonth(rawMonth: RawMonth): DateStr {
  const raw = String(rawMonth);
  if (rawMonth < 10) return `0${raw}`;
  return raw;
}

/** Bundled date components for injection. */
interface IDateComponents {
  readonly billingDate: DateStr;
  readonly mm: DateStr;
  readonly yyyy: DateStr;
}

/** Original param key from the template. */
type ParamKey = string;
/** Original param value from the template. */
type ParamVal = string;

/**
 * Inject a single key-value pair with date awareness.
 * @param key - The param key.
 * @param val - The original value.
 * @param dates - Bundled date components.
 * @returns The injected value.
 */
function injectOneParam(key: ParamKey, val: ParamVal, dates: IDateComponents): ParamVal {
  const isDate: IsDateKey = DATE_KEY_PATTERN.test(key);
  if (isDate) return dates.billingDate;
  const isMonth: IsDateKey = MONTH_KEY_PATTERN.test(key);
  if (isMonth) return dates.mm;
  const isYear: IsDateKey = YEAR_KEY_PATTERN.test(key);
  if (isYear) return dates.yyyy;
  return val;
}

/**
 * Inject date values into a params template.
 * Scans keys for date/month/year patterns and replaces with target date values.
 * @param template - Original params with placeholder date values.
 * @param targetDate - The date to inject.
 * @returns New params object with injected dates.
 */
function injectDateParams(
  template: Record<string, string>,
  targetDate: Date,
): Record<string, string> {
  const fullYear = targetDate.getFullYear();
  const rawMonth = targetDate.getMonth() + 1;
  const mm = padMonth(rawMonth);
  const yyyy = String(fullYear);
  const dates: IDateComponents = { billingDate: `${yyyy}-${mm}-01`, mm, yyyy };
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(template)) {
    result[key] = injectOneParam(key, val, dates);
  }
  return result;
}

export default buildProxyUrl;
export { buildProxyUrl, injectDateParams };
