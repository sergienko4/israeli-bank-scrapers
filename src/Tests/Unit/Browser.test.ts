import { buildContextOptions } from '../../Common/Browser.js';

describe('buildContextOptions', () => {
  it('returns Hebrew locale and Israel timezone', () => {
    const options = buildContextOptions();
    expect(options.locale).toBe('he-IL');
    expect(options.timezoneId).toBe('Asia/Jerusalem');
  });

  it('enables JavaScript', () => {
    const options = buildContextOptions();
    expect(options.javaScriptEnabled).toBe(true);
  });

  it('does not set userAgent (Camoufox handles it at C++ level)', () => {
    const options = buildContextOptions();
    expect(options.userAgent).toBeUndefined();
  });

  it('sets viewport to 1920x1280 for consistent rendering', () => {
    const options = buildContextOptions();
    expect(options.viewport).toEqual({ width: 1920, height: 1280 });
  });
});
