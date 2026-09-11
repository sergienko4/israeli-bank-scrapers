/**
 * ESLint canary — direct UTC calendar construction (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: construct calendar parts through UTC
 */

// Canary: Date.UTC normalizes invalid parts and rewrites years 0–99.
const UTC_DATE = Date.UTC(42, 6, 5);

export { UTC_DATE };
