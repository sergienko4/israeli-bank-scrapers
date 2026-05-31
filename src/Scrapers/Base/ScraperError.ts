/** General-purpose scraper error — used instead of bare `new Error()` for PII safety. */
export default class ScraperError extends Error {
  /**
   * Create a scraper error with a sanitized message.
   * @param message - Human-readable error description (must not contain PII).
   * @param options - Optional error options (e.g., cause).
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScraperError';
  }
}
