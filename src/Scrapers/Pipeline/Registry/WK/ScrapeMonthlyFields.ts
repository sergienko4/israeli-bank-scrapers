/**
 * WellKnown monthly-iteration field name mappings.
 * Extracted from ScrapeFieldMappings.ts to respect the 150-LOC ceiling.
 */

/** WellKnown monthly iteration field names. */
const PIPELINE_WELL_KNOWN_MONTHLY_FIELDS = {
  month: ['month', 'billingMonth', 'Month'],
  year: ['year', 'billingYear', 'Year'],
  compositeDate: ['billingMonth', 'BillingMonth', 'billingDate', 'BillingDate'],
  accountId: [
    'cardUniqueId',
    'cardUniqueID',
    'bankAccountUniqueID',
    'accountId',
    'cardNumber',
    'CardId',
    'card4Number',
  ],
} satisfies Record<string, string[]>;

export default PIPELINE_WELL_KNOWN_MONTHLY_FIELDS;
export { PIPELINE_WELL_KNOWN_MONTHLY_FIELDS };
