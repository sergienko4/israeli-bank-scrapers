/**
 * Isracard WellKnown Map — semantic field aliases for the DashboardMonth API.
 *
 * INDEPENDENCE CONTRACT:
 *   If Isracard renames a JSON key (e.g. "cardIndex" → "idx"), update this file ONLY.
 *   The DynamicMetadataMapper, IsracardPipeline, and all tests remain unchanged.
 *
 * DESIGN:
 *   Each entry is an ordered array of candidate key names (most specific first).
 *   `matchField(record, wkMap.cardIndex)` tries them in order — first hit wins.
 *   `findFieldValue(raw, wkMap.responseStatus)` uses BFS — no path hardcoding.
 *
 * ORDERING RULE: More specific / more common names first.
 *
 * Rule #11: Zero hardcoded keys in Pipeline/Phase files.
 *           This file IS the single source of truth for Isracard key names.
 */

/**
 * Shape of a WellKnown Map for card-account field discovery.
 * responseStatus is discovered via BFS (findFieldValue) — no 'Header.Status' hardcoding.
 */
export interface ICardWkMap {
  /**
   * Aliases for the API response status field.
   * Found via BFS (findFieldValue) — handles any nesting depth.
   * Expected value '1' indicates success.
   */
  readonly responseStatus: readonly string[];
  /** Aliases for the internal card index (CardsTransactionsListBean key). */
  readonly cardIndex: readonly string[];
  /** Aliases for the display card number (last 4 digits, shown to user). */
  readonly cardNumber: readonly string[];
  /** Aliases for the billing cycle date. */
  readonly billingDate: readonly string[];
}

/**
 * Isracard WellKnown Map — ordered semantic aliases per field.
 * As const: immutable at compile time, no accidental mutations.
 */
export const ISRACARD_WK_MAP: ICardWkMap = {
  responseStatus: [
    'Status', // current standard key (nested inside Header object)
    'status', // lowercase variant
    'HeaderStatus', // possible flattened variant
    'responseStatus', // fully qualified fallback
  ],
  cardIndex: [
    'cardIndex', // current standard key
    'idx', // possible renamed key (canary scenario)
    'index', // generic fallback
    'CardIndex', // camelCase variant seen in some API versions
  ],
  cardNumber: [
    'cardNumber', // current standard key
    'last4Digits', // VisaCal-style alias (cross-portal compatibility)
    'cardNum', // possible abbreviation
    'cardSuffix', // seen in Amex auth APIs
    'accountNumber', // generic fallback
  ],
  billingDate: [
    'billingDate', // current standard key
    'billing_date', // snake_case variant
    'date', // generic fallback
    'processedDate', // billing cycle processed date
  ],
} as const;
