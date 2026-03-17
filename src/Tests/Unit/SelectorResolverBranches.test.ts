import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns A mock debug logger object.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

const MOD = await import('../../Common/SelectorResolver.js');

describe('toXpathLiteral — escape branches', () => {
  it('wraps value in double quotes when no double quotes present', () => {
    const result = MOD.toXpathLiteral('hello world');
    expect(result).toBe('"hello world"');
  });

  it('wraps value in single quotes when value contains double quotes', () => {
    const result = MOD.toXpathLiteral('say "hello"');
    expect(result).toBe('\'say "hello"\'');
  });

  it('uses concat when value contains both single and double quotes', () => {
    const result = MOD.toXpathLiteral('it\'s a "test"');
    expect(result).toContain('concat(');
    expect(result).toContain("'\"'");
  });
});

describe('candidateToCss — textContent kind', () => {
  it('converts textContent candidate to clickableText xpath', () => {
    const result = MOD.candidateToCss({ kind: 'textContent', value: 'כניסה' });
    expect(result).toContain('xpath=');
    expect(result).toContain('כניסה');
  });
});
