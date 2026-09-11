/**
 * ESLint canary — direct Moment call (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 BANK CALENDAR
 */

/** Minimal Moment declaration for the syntax-only canary. */
declare function moment(): number;

const AMBIENT_NOW = moment();

export { AMBIENT_NOW };
