import { readFileSync } from 'fs';
import { dirname, join } from 'path';

import { buildContextOptions } from './Browser';

const pkgPath = require.resolve('playwright-core/package.json');
const browsersJson = JSON.parse(readFileSync(join(dirname(pkgPath), 'browsers.json'), 'utf8'));
const EXPECTED_VERSION: string = browsersJson.browsers
  .find((b: { name: string }) => b.name === 'chromium')
  .browserVersion.split('.')[0];

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
    expect(options.extraHTTPHeaders).toEqual(
      expect.objectContaining({
        'Accept-Language': expect.stringContaining('he-IL') as string,
        'sec-ch-ua': expect.stringContaining(EXPECTED_VERSION) as string,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }),
    );
  });

  it('always uses 1920x1080 viewport', () => {
    const options = buildContextOptions();
    expect(options.viewport).toEqual({ width: 1920, height: 1080 });
  });
});
