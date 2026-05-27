/**
 * BALANCE-RESOLVE WellKnown constants — standalone exports for the
 * v4 BALANCE-RESOLVE phase. Split from ScrapeFieldMappings.ts to
 * keep that file under the 150-line ceiling and to give the new
 * phase its own R-TXN-NOWK seam.
 *
 * The balance-alias list mirrors {@link PIPELINE_WELL_KNOWN_TXN_FIELDS.balance}
 * — they are the same value, exported under both names so legacy
 * consumers keep working while BALANCE-RESOLVE-zone code imports
 * through this dedicated seam.
 */

/**
 * Standalone balance-alias export for the BALANCE-RESOLVE phase.
 * Superset of the legacy `PIPELINE_WELL_KNOWN_TXN_FIELDS.balance`
 * list — the 12 legacy aliases PLUS three v4 additions validated
 * against C:\tmp\runs\pipeline\<bank>\ captures (2026-05-26):
 *   - `totalAmount`         — Max result.totalCycle[].totalAmount
 *   - `billingSumSekel`     — Amex data.billingSumSekel (aggregate)
 *   - `totalIlsBillingDate` — Amex per-card vouchers.totalForStatement
 *
 * Legacy SCRAPE-zone code continues to use the narrower
 * `PIPELINE_WELL_KNOWN_TXN_FIELDS.balance` list via the v3 fallback
 * paths; the v4 BALANCE-RESOLVE phase uses this widened list.
 */
export const PIPELINE_BALANCE_ALIASES: readonly string[] = [
  'AccountBalance',
  'balance',
  'nextTotalDebit',
  'currentBalance',
  'totalDebit',
  'currentDebit',
  'currentBillingAmount',
  'balanceAmount',
  'withdrawableBalance',
  'runningBalance',
  'currentAccountBalance',
  'closingBalance',
  'totalAmount',
  'billingSumSekel',
  'totalIlsBillingDate',
] as const;

/**
 * Field-name aliases that, when present alongside a balance field
 * in the same record, identify the currency of that balance. Used
 * by BALANCE-RESOLVE's ILS-first selection (F5).
 */
export const PIPELINE_CURRENCY_DISCRIMINATORS: readonly string[] = [
  'currency',
  'currencyCode',
] as const;

/** ISO 4217 numeric code for Israeli Shekel. */
export const ILS_CURRENCY_CODE = 376;

/** Hebrew shekel symbol. */
export const ILS_CURRENCY_SYMBOL = '₪';

/**
 * Per-card display-id field aliases used by BALANCE-RESOLVE's
 * per-card extractor when the response carries a tail-4 / short
 * suffix rather than a full `cardUniqueId`. Centralised here so bank
 * shape evolution lives next to the rest of the BALANCE-RESOLVE WK
 * surface (coding-principle-guidlines: constants from configuration).
 */
export const PIPELINE_DISPLAY_ID_FIELDS: readonly string[] = [
  'last4Digits',
  'cardSuffix',
  'cardLast4',
  'shortCardNumber',
  'card4Number',
] as const;
