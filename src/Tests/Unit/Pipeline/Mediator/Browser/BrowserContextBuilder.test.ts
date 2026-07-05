/**
 * Unit tests for BrowserContextBuilder — builds Playwright BrowserContextOptions
 * with Israeli locale, timezone, and desktop viewport defaults.
 */

import {
  ISRAEL_LOCALE,
  ISRAEL_TIMEZONE,
} from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserConfig.js';
import { buildContextOptions } from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js';

describe('buildContextOptions', () => {
  it('returns an options object with Israeli locale', () => {
    const opts = buildContextOptions();
    expect(opts.locale).toBe(ISRAEL_LOCALE);
  });

  it('sets timezone to Asia/Jerusalem', () => {
    const opts = buildContextOptions();
    expect(opts.timezoneId).toBe(ISRAEL_TIMEZONE);
  });

  it('has JavaScript enabled by default', () => {
    const opts = buildContextOptions();
    expect(opts.javaScriptEnabled).toBe(true);
  });

  it('leaves viewport null so the Camoufox-pinned window size is used', () => {
    const opts = buildContextOptions();
    expect(opts.viewport).toBeNull();
  });

  it('returns a new object each call (immutable callers)', () => {
    const a = buildContextOptions();
    const b = buildContextOptions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
