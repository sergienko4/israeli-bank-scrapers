/**
 * ESLint canary — direct Moment.tz call (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 BANK CALENDAR
 */

/** Minimal Moment.tz declaration for the syntax-only canary. */
declare const moment: { readonly tz: () => number };

const AMBIENT_TZ = moment.tz();

export { AMBIENT_TZ };
