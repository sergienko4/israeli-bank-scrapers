import { readFileSync } from 'fs';
import { dirname, join } from 'path';

import { buildContextOptions } from '../../Common/Browser';

interface IBrowsersJson {
  browsers: { name: string; browserVersion: string }[];
}

const PKG_PATH = require.resolve('playwright-core/package.json');
/** Directory containing playwright-core's browsers.json manifest. */
const BROWSERS_JSON_DIR = dirname(PKG_PATH);
/** Path to playwright-core's browsers.json file. */
const BROWSERS_JSON_PATH = join(BROWSERS_JSON_DIR, 'browsers.json');
/** Raw content of playwright-core's browsers.json manifest file. */
const BROWSERS_JSON_CONTENT = readFileSync(BROWSERS_JSON_PATH, 'utf8');
const BROWSERS_JSON = JSON.parse(BROWSERS_JSON_CONTENT) as IBrowsersJson;
const EXPECTED_VERSION: string = (
  BROWSERS_JSON.browsers.find(b => b.name === 'chromium')?.browserVersion ?? ''
).split('.')[0];

describe('buildContextOptions', () => {
  it('returns Hebrew locale and Israel timezone', () => {
    const options = buildContextOptions();
    expect(options.locale).toBe('he-IL');
    expect(options.timezoneId).toBe('Asia/Jerusalem');
  });

  it('returns Chrome UA matching installed Playwright Chromium version', () => {
    const options = buildContextOptions();
    expect(options.userAgent).toContain(`Chrome/${EXPECTED_VERSION}`);
    expect(options.userAgent).not.toContain('HeadlessChrome');
  });

  it('returns client hint headers matching Chrome version', () => {
    const options = buildContextOptions();
    const heIlMatcher = expect.stringContaining('he-IL') as string;
    const versionMatcher = expect.stringContaining(EXPECTED_VERSION) as string;
    const headersMatcher = expect.objectContaining({
      'Accept-Language': heIlMatcher,
      'sec-ch-ua': versionMatcher,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    }) as object;
    expect(options.extraHTTPHeaders).toEqual(headersMatcher);
  });

  it('always uses 1920x1080 viewport', () => {
    const options = buildContextOptions();
    expect(options.viewport).toEqual({ width: 1920, height: 1080 });
  });
});
