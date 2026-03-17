/**
 * Branch coverage tests for FormAnchor.ts.
 * Targets: discoverFormAnchor (found/not found), scopeCandidate all kinds,
 * scopeCandidates array mapping, evaluateFormWalk locator count=0.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger.
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

const {
  discoverFormAnchor: DISCOVER_FORM_ANCHOR,
  scopeCandidate: SCOPE_CANDIDATE,
  scopeCandidates: SCOPE_CANDIDATES,
} = await import('../../Common/FormAnchor.js');

describe('scopeCandidate — all kinds', () => {
  const formSelector = '#loginForm';

  it('scopes css kind to form descendant', () => {
    const result = SCOPE_CANDIDATE(formSelector, { kind: 'css', value: '#user' });
    expect(result.kind).toBe('css');
    expect(result.value).toBe('#loginForm #user');
  });

  it('scopes placeholder kind to form input[placeholder]', () => {
    const result = SCOPE_CANDIDATE(formSelector, { kind: 'placeholder', value: 'Enter ID' });
    expect(result.kind).toBe('css');
    expect(result.value).toContain('placeholder');
  });

  it('scopes ariaLabel kind to form input[aria-label]', () => {
    const result = SCOPE_CANDIDATE(formSelector, { kind: 'ariaLabel', value: 'password' });
    expect(result.kind).toBe('css');
    expect(result.value).toContain('aria-label');
  });

  it('scopes name kind to form [name]', () => {
    const result = SCOPE_CANDIDATE(formSelector, { kind: 'name', value: 'userId' });
    expect(result.kind).toBe('css');
    expect(result.value).toContain('name=');
  });

  it('returns labelText kind unchanged (not scopable)', () => {
    const candidate = { kind: 'labelText' as const, value: 'Username' };
    const result = SCOPE_CANDIDATE(formSelector, candidate);
    expect(result).toBe(candidate);
  });

  it('returns textContent kind unchanged (not scopable)', () => {
    const candidate = { kind: 'textContent' as const, value: 'Login' };
    const result = SCOPE_CANDIDATE(formSelector, candidate);
    expect(result).toBe(candidate);
  });

  it('returns clickableText kind unchanged (not scopable)', () => {
    const candidate = { kind: 'clickableText' as const, value: 'Submit' };
    const result = SCOPE_CANDIDATE(formSelector, candidate);
    expect(result).toBe(candidate);
  });
});

describe('scopeCandidates — array mapping', () => {
  it('scopes all scopable candidates in array', () => {
    const candidates = [
      { kind: 'css' as const, value: '#user' },
      { kind: 'labelText' as const, value: 'Username' },
      { kind: 'name' as const, value: 'pass' },
    ];
    const result = SCOPE_CANDIDATES('form', candidates);
    expect(result).toHaveLength(3);
    expect(result[0].value).toContain('form');
    expect(result[1].kind).toBe('labelText');
    expect(result[2].value).toContain('name=');
  });
});

describe('discoverFormAnchor', () => {
  it('returns null when locator count is 0', async () => {
    const ctx = {
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(0),
          evaluate: jest.fn(),
        }),
      }),
    };
    const result = await DISCOVER_FORM_ANCHOR(ctx as never, '#nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when evaluate returns empty string', async () => {
    const ctx = {
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(1),
          evaluate: jest.fn().mockResolvedValue(''),
        }),
      }),
    };
    const result = await DISCOVER_FORM_ANCHOR(ctx as never, '#input');
    expect(result).toBeNull();
  });

  it('returns form anchor when evaluate returns a selector', async () => {
    const ctx = {
      locator: jest.fn().mockReturnValue({
        first: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(1),
          evaluate: jest.fn().mockResolvedValue('#loginForm'),
        }),
      }),
    };
    const result = await DISCOVER_FORM_ANCHOR(ctx as never, '#input');
    expect(result).toBeDefined();
    expect(result?.selector).toBe('#loginForm');
  });
});
