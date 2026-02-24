import { isBotDetectionScript } from './browser';

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
});
