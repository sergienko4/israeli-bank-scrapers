import { createElementMediator } from '../../../../Scrapers/Pipeline/Mediator/CreateElementMediator.js';

/** Minimal mock Page for createElementMediator. */
const MOCK_PAGE = {
  /**
   * Stub url method.
   * @returns Stub URL string.
   */
  url: () => 'https://bank.example.com/login',
} as never;

describe('createElementMediator', () => {
  it('returns an object with all IElementMediator methods', () => {
    const mediator = createElementMediator(MOCK_PAGE);
    expect(typeof mediator.resolveField).toBe('function');
    expect(typeof mediator.resolveClickable).toBe('function');
    expect(typeof mediator.discoverForm).toBe('function');
    expect(typeof mediator.scopeToForm).toBe('function');
  });
});

describe('ElementMediator/resolveField', () => {
  it('returns failure Procedure (stub)', async () => {
    const mediator = createElementMediator(MOCK_PAGE);
    const result = await mediator.resolveField('username', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('stub');
      expect(result.errorMessage).toContain('resolveField');
    }
  });

  it('includes field key in error message', async () => {
    const mediator = createElementMediator(MOCK_PAGE);
    const result = await mediator.resolveField('password', []);
    if (!result.ok) {
      expect(result.errorMessage).toContain('password');
    }
  });

  it('includes candidate count in error message', async () => {
    const candidates = [
      { kind: 'labelText' as const, value: 'Username' },
      { kind: 'placeholder' as const, value: 'Enter username' },
    ];
    const mediator = createElementMediator(MOCK_PAGE);
    const result = await mediator.resolveField('username', candidates);
    if (!result.ok) {
      expect(result.errorMessage).toContain('2 candidates');
    }
  });
});

describe('ElementMediator/resolveClickable', () => {
  it('returns failure Procedure (stub)', async () => {
    const mediator = createElementMediator(MOCK_PAGE);
    const result = await mediator.resolveClickable([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('resolveClickable');
    }
  });
});

describe('ElementMediator/discoverForm', () => {
  it('returns None option (stub)', async () => {
    const mediator = createElementMediator(MOCK_PAGE);
    const mockContext = {
      isResolved: true,
      selector: '#login-form input',
      context: MOCK_PAGE,
      resolvedVia: 'bankConfig' as const,
      round: 'mainPage' as const,
    };
    const result = await mediator.discoverForm(mockContext);
    expect(result.has).toBe(false);
  });
});

describe('ElementMediator/scopeToForm', () => {
  it('returns candidates unchanged (passthrough stub)', () => {
    const mediator = createElementMediator(MOCK_PAGE);
    const candidates = [{ kind: 'labelText' as const, value: 'Password' }];
    const scoped = mediator.scopeToForm(candidates);
    expect(scoped).toBe(candidates);
  });

  it('returns empty array for empty input', () => {
    const mediator = createElementMediator(MOCK_PAGE);
    const scoped = mediator.scopeToForm([]);
    expect(scoped).toEqual([]);
  });
});
