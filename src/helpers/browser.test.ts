import { applyAntiDetection, isBotDetectionScript, maskHeadlessUserAgent, interceptionPriorities } from './browser';
import { createMockPage } from '../tests/mock-page';

describe('isBotDetectionScript', () => {
  it('detects detector-dom.min.js', () => {
    expect(isBotDetectionScript('https://example.com/scripts/detector-dom.min.js')).toBe(true);
  });

  it('detects detector-dom without min', () => {
    expect(isBotDetectionScript('https://example.com/detector-dom/init.js')).toBe(true);
  });

  it('detects bot-detect pattern', () => {
    expect(isBotDetectionScript('https://cdn.example.com/bot-detect.js')).toBe(true);
  });

  it('allows normal scripts', () => {
    expect(isBotDetectionScript('https://example.com/app.js')).toBe(false);
  });

  it('allows scripts with partial match', () => {
    expect(isBotDetectionScript('https://example.com/editor-dom.js')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBotDetectionScript('')).toBe(false);
  });
});

describe('interceptionPriorities', () => {
  it('has abort and continue priorities', () => {
    expect(interceptionPriorities.abort).toBe(1000);
    expect(interceptionPriorities.continue).toBe(10);
  });

  it('abort is higher priority than continue', () => {
    expect(interceptionPriorities.abort).toBeGreaterThan(interceptionPriorities.continue);
  });
});

describe('applyAntiDetection', () => {
  it('applies stealth script, user agent, and headers', async () => {
    const page = createMockPage();
    await applyAntiDetection(page);
    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/131'));
    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        'Accept-Language': expect.stringContaining('he-IL'),
        'sec-ch-ua': expect.stringContaining('131'),
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }),
    );
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
});

describe('maskHeadlessUserAgent', () => {
  it('replaces HeadlessChrome with Chrome in user agent', async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValue('Mozilla/5.0 HeadlessChrome/131.0.0.0 Safari/537.36');
    await maskHeadlessUserAgent(page);
    expect(page.setUserAgent).toHaveBeenCalledWith('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36');
  });

  it('handles user agent without HeadlessChrome', async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValue('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36');
    await maskHeadlessUserAgent(page);
    expect(page.setUserAgent).toHaveBeenCalledWith('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36');
  });
});
