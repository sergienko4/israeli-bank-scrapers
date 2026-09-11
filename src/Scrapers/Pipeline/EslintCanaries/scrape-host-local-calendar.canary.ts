/**
 * ESLint canary — bank-calendar boundary (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: read the HOST machine calendar
 */

/** A stamp written from a bank-calendar day, as `MonthChunking` writes them. */
const STAMP = new Date(0);

// Canary: reads a calendar component in the HOST's zone. For a March chunk
// this names February on any host west of UTC.
const HOST_MONTH = STAMP.getMonth() + 1;

export { HOST_MONTH };
