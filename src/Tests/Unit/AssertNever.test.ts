/**
 * Branch coverage tests for AssertNever.ts.
 * Targets: default error message, custom error message.
 */
import { assertNever } from '../../AssertNever.js';
import ScraperError from '../../Scrapers/Base/ScraperError.js';

/**
 * Asserts that fn throws a ScraperError with the expected message.
 * @param fn - function expected to throw.
 * @param message - expected error message.
 * @returns true when assertions pass.
 */
function expectScraperError(fn: () => never, message: string): boolean {
  expect(fn).toThrow(ScraperError);
  expect(fn).toThrow(message);
  return true;
}

describe('assertNever', () => {
  it('throws ScraperError with default message for unexpected value', () => {
    expectScraperError(() => assertNever('unexpected' as never), 'Unexpected object: unexpected');
  });

  it('throws ScraperError with custom message when provided', () => {
    expectScraperError(() => assertNever('bad' as never, 'Custom error'), 'Custom error');
  });
});
