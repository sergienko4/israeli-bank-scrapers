import { assertNever } from '../../AssertNever.js';
import ScraperError from '../../Scrapers/Base/ScraperError.js';

describe('assertNever', () => {
  it('throws ScraperError with default message for unexpected value', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(ScraperError);
    expect(() => assertNever('unexpected' as never)).toThrow('Unexpected object: unexpected');
  });

  it('throws ScraperError with custom message when provided', () => {
    expect(() => assertNever('bad' as never, 'Custom error')).toThrow(ScraperError);
    expect(() => assertNever('bad' as never, 'Custom error')).toThrow('Custom error');
  });
});
