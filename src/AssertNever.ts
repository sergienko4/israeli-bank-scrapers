import { ScraperWebsiteChangedError } from './Scrapers/Base/ScraperWebsiteChangedError';

/**
 * Exhaustiveness check helper for discriminated unions.
 * Throws a ScraperWebsiteChangedError when a value that should be unreachable is encountered at runtime.
 *
 * @param x - the value that should never occur (typed as `never`)
 * @param error - optional additional context to include in the error message
 * @returns never — always throws
 */
export function assertNever(x: never, error = ''): never {
  throw new ScraperWebsiteChangedError('assertNever', error || `Unexpected object: ${String(x)}`);
}

export default assertNever;
