/**
 * Field-match types for tracing which API key matched which WellKnown entry.
 * Used by extractIds to separate display IDs from query IDs.
 */

/** Receipt for a single field extraction -- traces what matched, from where. */
export default interface IFieldMatch {
  /** Exact key from the API JSON (e.g., "cardUniqueID"). */
  readonly originalKey: string;
  /** Actual value (e.g., "3307405447882020118"). */
  readonly value: string | number;
  /** Which WK entry matched (e.g., "cardUniqueId"). */
  readonly matchingKey: string;
}
