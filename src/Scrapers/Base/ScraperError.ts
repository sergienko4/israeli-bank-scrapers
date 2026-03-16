/** General-purpose scraper error — used instead of bare `new Error()` for PII safety. */
export default class ScraperError extends Error {
  /**
   * Create a scraper error with a sanitized message.
   * @param message - Human-readable error description (must not contain PII).
   */
  constructor(message: string) {
    super(message);
    this.name = 'ScraperError';
  }
}
