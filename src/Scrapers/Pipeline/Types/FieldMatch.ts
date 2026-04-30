/**
 * Field-match types for tracing which API key matched which WellKnown entry.
 * Used by extractIds to separate display IDs from query IDs.
 */

/** The exact key name from the raw API JSON (e.g. "cardUniqueID"). */
type ApiKeyStr = string;

/** Receipt for a single field extraction -- traces what matched, from where. */
interface IFieldMatch {
  /** Exact key from the API JSON (e.g., "cardUniqueID"). */
  readonly originalKey: ApiKeyStr;
  /** Actual value (e.g., "3307405447882020118"). */
  readonly value: string | number;
  /** Which WK entry matched (e.g., "cardUniqueId"). */
  readonly matchingKey: ApiKeyStr;
}

/** Per-card/account identity -- separates display from query IDs. */
interface IAccountIdentity {
  /** What to send to API (long, opaque). */
  readonly queryIdentifier: IFieldMatch;
  /** What to show to user (short, recognizable). */
  readonly displayIdentifier: IFieldMatch;
}

/** Sentinel IFieldMatch for fallback when no WK field matched. */
const FALLBACK_MATCH_KEY = 'fallback';

/**
 * Build a fallback IFieldMatch when no WK entry matched.
 * @param value - Fallback value to use.
 * @returns IFieldMatch with sentinel keys.
 */
function buildFallbackMatch(value: string): IFieldMatch {
  return { originalKey: 'NONE', value, matchingKey: FALLBACK_MATCH_KEY };
}

export type { IAccountIdentity, IFieldMatch };
export { buildFallbackMatch, FALLBACK_MATCH_KEY };
