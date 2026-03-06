/** Base class for all scraper-related runtime failures. */
export abstract class ScraperError extends Error {
  /**
   * Creates a ScraperError with a code, message, and optional context bag.
   *
   * @param code - short machine-readable error code (e.g. 'AUTH_FAILED')
   * @param message - human-readable error message
   * @param context - optional extra metadata for diagnostics
   */
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
export default ScraperError;
