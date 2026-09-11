/**
 * ESLint canary — host-locale bank-calendar formatting (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: format a date in the HOST machine calendar
 */

/** A boundary instant whose bank day differs from UTC. */
const STAMP = new Date('2026-01-01T22:30:00.000Z');

// Canary: choosing a locale does not choose the timezone used for the day.
const HOST_DAY = STAMP.toLocaleDateString('he-IL');

export { HOST_DAY };
