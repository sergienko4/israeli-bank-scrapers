import { buildContextOptions } from '../../Common/Browser.js';
import { ISRAEL_LOCALE, ISRAEL_TIMEZONE } from '../../Common/Config/BrowserConfig.js';

describe('buildContextOptions', () => {
  it('returns Hebrew locale and Israel timezone', () => {
    const options = buildContextOptions();
    expect(options.locale).toBe(ISRAEL_LOCALE);
    expect(options.timezoneId).toBe(ISRAEL_TIMEZONE);
  });

  it('enables JavaScript', () => {
    const options = buildContextOptions();
    expect(options.javaScriptEnabled).toBe(true);
  });

  it('does not set userAgent (Camoufox handles it at C++ level)', () => {
    const options = buildContextOptions();
    expect(options.userAgent).toBeUndefined();
  });

  it('leaves viewport null so the Camoufox-pinned 1920x1080 window is used', () => {
    const options = buildContextOptions();
    expect(options.viewport).toBeNull();
  });
});
