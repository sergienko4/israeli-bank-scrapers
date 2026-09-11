/**
 * ESLint canary — host-zone Date construction boundary (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: new Date(year, month, day)
 */

// Canary: builds an instant from components in the HOST's zone.
const HOST_MONTH_START = new Date(2026, 2, 1);

export { HOST_MONTH_START };
