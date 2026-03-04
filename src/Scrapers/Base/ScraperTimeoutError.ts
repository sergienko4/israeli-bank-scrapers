import { ScraperError } from './ScraperError';

/** Thrown when a scraper step exceeds its time budget or a network/page load times out. */
export class ScraperTimeoutError extends ScraperError {
  constructor(bankId: string, step: string) {
    super('TIMEOUT', `Timeout reached during: ${step}`, { bankId, step });
  }
}
export default ScraperTimeoutError;
