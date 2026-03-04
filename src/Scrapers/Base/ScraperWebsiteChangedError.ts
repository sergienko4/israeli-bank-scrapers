import { ScraperError } from './ScraperError';

/** Thrown when the bank's website has changed (selectors don't match, unexpected data shape). */
export class ScraperWebsiteChangedError extends ScraperError {
  constructor(bankId: string, details: string) {
    super('WEBSITE_CHANGED', `Potential UI change detected in ${bankId}: ${details}`, { bankId });
  }
}
export default ScraperWebsiteChangedError;
