import { applyAntiDetection } from './browser';
import { createMockPage } from '../tests/mock-page';

describe('applyAntiDetection', () => {
  it('sets realistic user agent, headers, and Hebrew locale', async () => {
    const page = createMockPage();
    await applyAntiDetection(page);
    expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/131'));
    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        'Accept-Language': expect.stringContaining('he-IL'),
        'sec-ch-ua': expect.stringContaining('131'),
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }),
    );
    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
  });

  it('extracts Chrome version from browser version', async () => {
    const page = createMockPage();
    page.browser().version.mockResolvedValue('HeadlessChrome/120.0.6099.71');
    await applyAntiDetection(page);
    expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/120'));
  });

  it('falls back to version 131 when version cannot be parsed', async () => {
    const page = createMockPage();
    page.browser().version.mockResolvedValue('UnknownBrowser/1.0');
    await applyAntiDetection(page);
    expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/131'));
  });

  it('sets Israel timezone', async () => {
    const page = createMockPage();
    await applyAntiDetection(page);
    expect(page.emulateTimezone).toHaveBeenCalledWith('Asia/Jerusalem');
  });
});
