/** Scrape phase WK — signature keys, API patterns, transaction field mappings. */

/** Known date formats across Israeli banks. */
export const KNOWN_DATE_FORMATS: string[] = [
  'YYYYMMDD',
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'YYYY-MM-DDTHH:mm:ss',
  'DD-MM-YYYY',
  'YYYY.MM.DD',
  'DD.MM.YYYY',
  'YYYY.MM.DDTHH:mm:ss',
];

export { default as PIPELINE_WELL_KNOWN_TXN_FIELDS } from './ScrapeFieldMappings.js';
