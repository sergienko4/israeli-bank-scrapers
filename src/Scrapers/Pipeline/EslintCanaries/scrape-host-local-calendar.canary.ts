/**
 * ESLint canary — bank-calendar boundary (§24).
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: 🚫 BANK CALENDAR
 */

/** A stamp written from a bank-calendar day, as `MonthChunking` writes them. */
const STAMP = new Date(0);

// Canary: reads a calendar component in the HOST's zone. For a March chunk
// this names February on any host west of UTC.
const HOST_MONTH = STAMP.getMonth() + 1;

// Canary: builds an instant from components in the HOST's zone.
const HOST_MONTH_START = new Date(2026, 2, 1);

export { HOST_MONTH, HOST_MONTH_START };
