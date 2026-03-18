/**
 * Branch coverage tests for Fetch.ts detectWafBlock.
 * Targets: WAF detection by status code (429/503), body pattern matching
 * (block automation, attention required, just a moment, access denied),
 * and clean response passthrough.
 */
import { detectWafBlock } from '../../Common/Fetch.js';

describe('detectWafBlock', () => {
  const wafCases = [
    ['detects WAF by status 429', 429, '', 'HTTP 429'],
    ['detects WAF by status 503', 503, '', 'HTTP 503'],
    [
      'detects "block automation"',
      200,
      '<html>Please Block Automation detected</html>',
      'block automation',
    ],
    [
      'detects "attention required"',
      200,
      '<title>Attention Required! | Cloudflare</title>',
      'attention required',
    ],
    ['detects "just a moment"', 200, '<h1>Just a moment...</h1>', 'just a moment'],
    ['detects "access denied"', 200, '<h1>Access Denied</h1>', 'access denied'],
  ] as const;

  it.each(wafCases)('%s', (...args: readonly [string, number, string, string]) => {
    const [, status, body, expected] = args;
    const wafResult = detectWafBlock(status, body);
    expect(wafResult).toContain(expected);
  });

  const cleanCases = [
    ['returns empty for 200 with clean body', 200, '{"data": "ok"}'],
    ['returns empty for 200 with empty body', 200, ''],
    ['returns empty for 200 with unrelated body', 200, '<html><body>Hello World</body></html>'],
    ['returns empty for 204 No Content', 204, ''],
  ] as const;

  it.each(cleanCases)('%s', (_label, status, body) => {
    const result = detectWafBlock(status, body);
    expect(result).toBe('');
  });
});
