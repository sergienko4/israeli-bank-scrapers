import { ScraperError } from './ScraperError';

/** Thrown when the bank's website has changed (selectors don't match, unexpected data shape). */
export class ScraperWebsiteChangedError extends ScraperError {
  /**
   * Creates a website-changed error for the given bank and change description.
   *
   * @param bankId - identifier of the bank where the UI change was detected
   * @param details - description of what changed or what was unexpected
   */
  constructor(bankId: string, details: string) {
    super('WEBSITE_CHANGED', `Potential UI change detected in ${bankId}: ${details}`, { bankId });
  }
}
export default ScraperWebsiteChangedError;
