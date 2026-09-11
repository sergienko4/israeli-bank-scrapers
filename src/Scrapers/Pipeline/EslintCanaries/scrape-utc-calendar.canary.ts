/**
 * ESLint canary — raw UTC calendar reads (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 BANK CALENDAR
 */

/** A stamp whose UTC components must not bypass the bank-calendar provider. */
const STAMP = new Date(0);

// Canary: a UTC getter is deterministic but still reads instant semantics.
const UTC_MONTH = STAMP.getUTCMonth() + 1;

export { UTC_MONTH };
