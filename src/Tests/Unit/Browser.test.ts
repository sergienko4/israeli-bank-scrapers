import { buildContextOptions } from '../../Common/Browser.js';
import {
  DESKTOP_VIEWPORT_HEIGHT,
  DESKTOP_VIEWPORT_WIDTH,
} from '../../Common/Config/BrowserConfig.js';

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

  it('sets 1920x1080 viewport (Israeli banks hide login at smaller sizes)', () => {
    const options = buildContextOptions();
    expect(options.viewport).toEqual({
      width: DESKTOP_VIEWPORT_WIDTH,
      height: DESKTOP_VIEWPORT_HEIGHT,
    });
  });
});
