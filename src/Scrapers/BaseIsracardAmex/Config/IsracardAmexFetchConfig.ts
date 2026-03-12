/** Date format for Isracard/Amex API requests and transaction parsing. */
export const ISRACARD_DATE_FORMAT = 'DD/MM/YYYY';

/** Delay between consecutive API calls to respect rate limits (ms). */
export const RATE_LIMIT_SLEEP_MS = 1000;

/** Number of transactions to process in each enrichment batch. */
export const TRANSACTIONS_BATCH_SIZE = 10;
