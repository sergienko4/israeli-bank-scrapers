/**
 * Amex WellKnown Map — semantic field aliases for the DashboardMonth API.
 *
 * INDEPENDENT from IsracardWkMap — separate pipeline per mandate.
 * Same API format today; divergence handled by updating this file only.
 *
 * Rule #11: Zero hardcoded keys in Pipeline/Phase files.
 *           This file IS the single source of truth for Amex key names.
 */

import type { ICardWkMap } from '../Isracard/IsracardWkMap.js';

/**
 * Amex WellKnown Map — ordered semantic aliases per field.
 * As const: immutable at compile time, no accidental mutations.
 */
const AMEX_WK_MAP: ICardWkMap = {
  responseStatus: [
    'Status', // current standard key (inside Header object)
    'status', // lowercase variant
    'HeaderStatus', // possible flattened variant
    'responseStatus', // fully qualified fallback
  ],
  cardIndex: [
    'cardIndex', // current standard key
    'idx', // possible renamed key
    'index', // generic fallback
    'CardIndex', // camelCase variant
  ],
  cardNumber: [
    'cardNumber', // current standard key
    'last4Digits', // cross-portal VisaCal-style alias
    'cardNum', // abbreviation
    'cardSuffix', // seen in auth APIs
    'accountNumber', // generic fallback
  ],
  billingDate: [
    'billingDate', // current standard key
    'billing_date', // snake_case variant
    'date', // generic fallback
    'processedDate', // billing cycle processed date
  ],
} as const;

export default AMEX_WK_MAP;
