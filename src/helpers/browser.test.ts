import { buildContextOptions } from './browser';

describe('buildContextOptions', () => {
  it('returns Hebrew locale and Israel timezone', () => {
    const options = buildContextOptions();
    expect(options.locale).toBe('he-IL');
    expect(options.timezoneId).toBe('Asia/Jerusalem');
  });

  it('returns Chrome UA with version 131', () => {
    const options = buildContextOptions();
    expect(options.userAgent).toContain('Chrome/131');
    expect(options.userAgent).not.toContain('HeadlessChrome');
  });

  it('returns client hint headers matching Chrome version', () => {
    const options = buildContextOptions();
    expect(options.extraHTTPHeaders).toEqual(
      expect.objectContaining({
        'Accept-Language': expect.stringContaining('he-IL') as string,
        'sec-ch-ua': expect.stringContaining('131') as string,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }),
    );
  });

  it('uses default viewport 1024x768 when none provided', () => {
    const options = buildContextOptions();
    expect(options.viewport).toEqual({ width: 1024, height: 768 });
  });

  it('uses custom viewport when provided', () => {
    const options = buildContextOptions({ width: 1920, height: 1080 });
    expect(options.viewport).toEqual({ width: 1920, height: 1080 });
  });
});
