/**
 * Unit tests for BrowserContextBuilder — builds Playwright BrowserContextOptions
 * with Israeli locale, timezone, and desktop viewport defaults.
 */

import { buildContextOptions } from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js';

describe('buildContextOptions', () => {
  it('returns an options object with Israeli locale', () => {
    const opts = buildContextOptions();
    expect(opts.locale).toBe('he-IL');
  });

  it('sets timezone to Asia/Jerusalem', () => {
    const opts = buildContextOptions();
    expect(opts.timezoneId).toBe('Asia/Jerusalem');
  });

  it('has JavaScript enabled by default', () => {
    const opts = buildContextOptions();
    expect(opts.javaScriptEnabled).toBe(true);
  });

  it('sets desktop viewport 1920x1080', () => {
    const opts = buildContextOptions();
    expect(opts.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('returns a new object each call (immutable callers)', () => {
    const a = buildContextOptions();
    const b = buildContextOptions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
