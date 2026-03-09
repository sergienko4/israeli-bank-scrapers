import ScraperError from './Scrapers/Base/ScraperError.js';

/** Sentinel value for exhaustiveness checks — used as the second export. */
export const ASSERT_NEVER_TAG = 'assertNever' as const;

/**
 * Exhaustive check for switch statements — compile error if a case is missed.
 * @param value - The value that should be unreachable.
 * @param error - Optional custom error message.
 */
export function assertNever(value: never, error = ''): never {
  throw new ScraperError(error || `Unexpected object: ${String(value)}`);
}
