import { createElementMediator } from '../../../../Scrapers/Pipeline/Mediator/CreateElementMediator.js';
import { makeMockPage } from './MockFactories.js';

describe('createElementMediator', () => {
  it('returns an object with all IElementMediator methods', () => {
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    expect(typeof mediator.resolveField).toBe('function');
    expect(typeof mediator.resolveClickable).toBe('function');
    expect(typeof mediator.discoverForm).toBe('function');
    expect(typeof mediator.scopeToForm).toBe('function');
  });
});

describe('ElementMediator/resolveField', () => {
  it('returns failure Procedure (stub)', async () => {
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    const result = await mediator.resolveField('username', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('stub');
      expect(result.errorMessage).toContain('resolveField');
    }
  });

  it('includes field key in error message', async () => {
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    const result = await mediator.resolveField('password', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('password');
    }
  });

  it('includes candidate count in error message', async () => {
    const candidates = [
      { kind: 'labelText' as const, value: 'Username' },
      { kind: 'placeholder' as const, value: 'Enter username' },
    ];
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    const result = await mediator.resolveField('username', candidates);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('2 candidates');
    }
  });
});

describe('ElementMediator/resolveClickable', () => {
  it('returns failure Procedure (stub)', async () => {
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    const result = await mediator.resolveClickable([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('resolveClickable');
    }
  });
});

describe('ElementMediator/discoverForm', () => {
  it('returns None option (stub)', async () => {
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    const mockContext = {
      isResolved: true,
      selector: '#login-form input',
      context: page,
      resolvedVia: 'bankConfig' as const,
      round: 'mainPage' as const,
    };
    const result = await mediator.discoverForm(mockContext);
    expect(result.has).toBe(false);
  });
});

describe('ElementMediator/scopeToForm', () => {
  it('returns candidates unchanged (passthrough stub)', () => {
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    const candidates = [{ kind: 'labelText' as const, value: 'Password' }];
    const scoped = mediator.scopeToForm(candidates);
    expect(scoped).toBe(candidates);
  });

  it('returns empty array for empty input', () => {
    const page = makeMockPage();
    const mediator = createElementMediator(page);
    const scoped = mediator.scopeToForm([]);
    expect(scoped).toEqual([]);
  });
});
