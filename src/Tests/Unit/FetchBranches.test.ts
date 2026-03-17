import { detectWafBlock } from '../../Common/Fetch.js';

describe('detectWafBlock', () => {
  it('detects WAF by status 429', () => {
    const result = detectWafBlock(429, '');
    expect(result).toBe('HTTP 429');
  });

  it('detects WAF by status 503', () => {
    const result = detectWafBlock(503, '');
    expect(result).toBe('HTTP 503');
  });

  it('returns empty for normal 200 status with clean body', () => {
    const result = detectWafBlock(200, '{"data": "ok"}');
    expect(result).toBe('');
  });

  it('returns empty for normal 200 status with empty body', () => {
    const result = detectWafBlock(200, '');
    expect(result).toBe('');
  });

  it('detects WAF by "block automation" in body', () => {
    const result = detectWafBlock(200, '<html>Please Block Automation detected</html>');
    expect(result).toContain('block automation');
  });

  it('detects WAF by "attention required" in body', () => {
    const result = detectWafBlock(200, '<title>Attention Required! | Cloudflare</title>');
    expect(result).toContain('attention required');
  });

  it('detects WAF by "just a moment" in body', () => {
    const result = detectWafBlock(200, '<h1>Just a moment...</h1>');
    expect(result).toContain('just a moment');
  });

  it('detects WAF by "access denied" in body', () => {
    const result = detectWafBlock(200, '<h1>Access Denied</h1>');
    expect(result).toContain('access denied');
  });

  it('returns empty for 200 with unrelated body', () => {
    const result = detectWafBlock(200, '<html><body>Hello World</body></html>');
    expect(result).toBe('');
  });

  it('returns empty for 204 No Content', () => {
    const result = detectWafBlock(204, '');
    expect(result).toBe('');
  });
});
