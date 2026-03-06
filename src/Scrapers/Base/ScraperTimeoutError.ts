import { ScraperError } from './ScraperError';

/** Thrown when a scraper step exceeds its time budget or a network/page load times out. */
export class ScraperTimeoutError extends ScraperError {
  /**
   * Creates a timeout error for a specific step in the scraping process.
   *
   * @param bankId - identifier of the bank where the timeout occurred
   * @param step - name of the step that timed out
   */
  constructor(bankId: string, step: string) {
    super('TIMEOUT', `Timeout reached during: ${step}`, { bankId, step });
  }
}
export default ScraperTimeoutError;
