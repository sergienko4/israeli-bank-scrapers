/** Base class for all scraper-related runtime failures. */
export abstract class ScraperError extends Error {
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
