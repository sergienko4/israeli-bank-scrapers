/**
 * Branch coverage tests for FormAnchor.ts.
 * Targets: discoverFormAnchor (found/not found), scopeCandidate all kinds,
 * scopeCandidates array mapping, evaluateFormWalk locator count=0.
 */
import { jest } from '@jest/globals';

import { createDebugMock } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

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

  const unscopableKinds = [
    ['labelText', 'Username'],
    ['textContent', 'Login'],
    ['clickableText', 'Submit'],
    ['xpath', '//button[@id="submit"]'],
  ] as const;

  it.each(unscopableKinds)('returns %s kind unchanged (not scopable)', (kind, value) => {
    const candidate = { kind, value };
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

/** Re-export shared factory with evaluate override for form discovery. */
const { createLabelCtx: CREATE_LABEL_CTX } = await import('../MockModuleFactories.js');

/**
 * Build a mock context for discoverFormAnchor tests.
 * @param count - Locator element count.
 * @param evaluateVal - Value returned by evaluate().
 * @returns Mock context object.
 */
function makeDiscoverCtx(count: number, evaluateVal: string): Record<string, jest.Mock> {
  return CREATE_LABEL_CTX({ count, tagName: evaluateVal });
}

describe('discoverFormAnchor', () => {
  it('returns null when locator count is 0', async () => {
    const ctx = makeDiscoverCtx(0, '');
    const result = await DISCOVER_FORM_ANCHOR(ctx as never, '#nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when evaluate returns empty string', async () => {
    const ctx = makeDiscoverCtx(1, '');
    const result = await DISCOVER_FORM_ANCHOR(ctx as never, '#input');
    expect(result).toBeNull();
  });

  it('returns form anchor when evaluate returns a selector', async () => {
    const ctx = makeDiscoverCtx(1, '#loginForm');
    const result = await DISCOVER_FORM_ANCHOR(ctx as never, '#input');
    expect(result).toBeDefined();
    expect(result?.selector).toBe('#loginForm');
  });
});
