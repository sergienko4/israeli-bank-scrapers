/**
 * Unit tests for CreateElementMediator.ts.
 * Covers all 5 methods: resolveField, resolveClickable, discoverErrors,
 * discoverForm, scopeToForm — success and failure paths.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/PipelineFieldResolver.js',
  () => ({ resolveFieldPipeline: jest.fn() }),
);

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Mediator/FormErrorDiscovery.js', () => ({
  discoverFormErrors: jest.fn(),
  checkFrameForErrors: jest.fn(),
  NO_ERRORS: { hasErrors: false, errors: [], summary: '' },
}));

jest.unstable_mockModule('../../../../../Common/FormAnchor.js', () => ({
  discoverFormAnchor: jest.fn(),
  /**
   * Mock scopeCandidates — returns candidates unchanged.
   * @param _scope - Ignored scope selector.
   * @param candidates - Candidates to return.
   * @returns Same candidates array.
   */
  scopeCandidates: jest.fn((_scope: string, candidates: unknown[]) => candidates),
}));

jest.unstable_mockModule('../../../../../Common/Debug.js', () => ({
  /**
   * Mock getDebug — returns a no-op logger.
   * @returns Logger with jest.fn() for all methods.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    trace: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Mock runWithBankContext — passthrough.
   * @param _b - Ignored bank name.
   * @param fn - Function to call.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

const PFR_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/PipelineFieldResolver.js');
const FED_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/FormErrorDiscovery.js');
const FA_MOD = await import('../../../../../Common/FormAnchor.js');
const MED_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/CreateElementMediator.js');
const FACTORY = await import('../MockPipelineFactories.js');

/** Resolved IFieldContext returned by mock resolveFieldPipeline. */
const RESOLVED_CTX = {
  isResolved: true,
  selector: '#field',
  resolvedVia: 'wellKnown' as const,
  round: 'mainPage' as const,
  context: FACTORY.makeMockFullPage(),
};

// ── Structure ─────────────────────────────────────────────

describe('createElementMediator/structure', () => {
  it('returns object with all 5 IElementMediator methods', () => {
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    expect(typeof mediator.resolveField).toBe('function');
    expect(typeof mediator.resolveClickable).toBe('function');
    expect(typeof mediator.discoverErrors).toBe('function');
    expect(typeof mediator.discoverForm).toBe('function');
    expect(typeof mediator.scopeToForm).toBe('function');
  });
});

// ── resolveField ──────────────────────────────────────────

describe('createElementMediator/resolveField', () => {
  it('returns succeed(IFieldContext) when resolveFieldPipeline resolves', async () => {
    const fn = PFR_MOD.resolveFieldPipeline as unknown as jest.Mock;
    fn.mockResolvedValue(RESOLVED_CTX);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.resolveField('username', []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.selector).toBe('#field');
  });

  it('returns fail when resolveFieldPipeline returns isResolved=false', async () => {
    const fn = PFR_MOD.resolveFieldPipeline as unknown as jest.Mock;
    const notFoundCtx = { ...RESOLVED_CTX, isResolved: false, selector: '' };
    fn.mockResolvedValue(notFoundCtx);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.resolveField('id', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toContain('Field not found');
  });

  it('returns fail when resolveFieldPipeline throws', async () => {
    const fn = PFR_MOD.resolveFieldPipeline as unknown as jest.Mock;
    fn.mockRejectedValue(new Error('resolver crash'));
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.resolveField('username', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toBe('resolver crash');
  });
});

// ── resolveClickable ──────────────────────────────────────

describe('createElementMediator/resolveClickable', () => {
  it('returns succeed(IFieldContext) when __submit__ resolves', async () => {
    const fn = PFR_MOD.resolveFieldPipeline as unknown as jest.Mock;
    fn.mockResolvedValue(RESOLVED_CTX);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const candidates = [{ kind: 'textContent' as const, value: 'כניסה' }];
    const result = await mediator.resolveClickable(candidates);
    expect(result.ok).toBe(true);
  });

  it('returns fail when __submit__ not found', async () => {
    const fn = PFR_MOD.resolveFieldPipeline as unknown as jest.Mock;
    const notFoundCtx = { ...RESOLVED_CTX, isResolved: false };
    fn.mockResolvedValue(notFoundCtx);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.resolveClickable([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toContain('Clickable not found');
  });

  it('returns fail when resolveFieldPipeline throws', async () => {
    const fn = PFR_MOD.resolveFieldPipeline as unknown as jest.Mock;
    fn.mockRejectedValue(new Error('click crash'));
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.resolveClickable([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toBe('click crash');
  });
});

// ── discoverErrors ────────────────────────────────────────

describe('createElementMediator/discoverErrors', () => {
  it('returns Layer 1 result when DOM errors found', async () => {
    const l1Fn = FED_MOD.discoverFormErrors as unknown as jest.Mock;
    const l1Result = { hasErrors: true, errors: [], summary: 'dom error' };
    l1Fn.mockResolvedValue(l1Result);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const frame = FACTORY.makeMockFullPage();
    const result = await mediator.discoverErrors(frame);
    expect(result.hasErrors).toBe(true);
    expect(result.summary).toBe('dom error');
  });

  it('falls through to Layer 2 when Layer 1 finds nothing', async () => {
    const l1Fn = FED_MOD.discoverFormErrors as unknown as jest.Mock;
    const l2Fn = FED_MOD.checkFrameForErrors as unknown as jest.Mock;
    const noErrors = { hasErrors: false, errors: [], summary: '' };
    const wkError = { hasErrors: true, errors: [], summary: 'wellknown error' };
    l1Fn.mockResolvedValue(noErrors);
    l2Fn.mockResolvedValue(wkError);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const frame = FACTORY.makeMockFullPage();
    const result = await mediator.discoverErrors(frame);
    expect(result.hasErrors).toBe(true);
    expect(result.summary).toBe('wellknown error');
  });

  it('returns no-errors when both layers find nothing', async () => {
    const l1Fn = FED_MOD.discoverFormErrors as unknown as jest.Mock;
    const l2Fn = FED_MOD.checkFrameForErrors as unknown as jest.Mock;
    const noErrors = { hasErrors: false, errors: [], summary: '' };
    l1Fn.mockResolvedValue(noErrors);
    l2Fn.mockResolvedValue(noErrors);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const frame = FACTORY.makeMockFullPage();
    const result = await mediator.discoverErrors(frame);
    expect(result.hasErrors).toBe(false);
  });
});

// ── discoverForm ──────────────────────────────────────────

describe('createElementMediator/discoverForm', () => {
  it('returns some(anchor) when form anchor found', async () => {
    const faFn = FA_MOD.discoverFormAnchor as unknown as jest.Mock;
    const anchor = { selector: 'form#login', inputs: [] };
    faFn.mockResolvedValue(anchor);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.discoverForm(RESOLVED_CTX);
    expect(result.has).toBe(true);
  });

  it('returns none() when form anchor not found (returns null)', async () => {
    const faFn = FA_MOD.discoverFormAnchor as unknown as jest.Mock;
    faFn.mockResolvedValue(null);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.discoverForm(RESOLVED_CTX);
    expect(result.has).toBe(false);
  });

  it('returns none() and logs when discoverFormAnchor throws', async () => {
    const faFn = FA_MOD.discoverFormAnchor as unknown as jest.Mock;
    faFn.mockRejectedValue(new Error('anchor error'));
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const result = await mediator.discoverForm(RESOLVED_CTX);
    expect(result.has).toBe(false);
  });
});

// ── scopeToForm ───────────────────────────────────────────

describe('createElementMediator/scopeToForm', () => {
  it('returns candidates unchanged when no form cached', () => {
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    const candidates = [{ kind: 'labelText' as const, value: 'שם משתמש' }];
    const result = mediator.scopeToForm(candidates);
    expect(result).toBe(candidates);
  });

  it('calls scopeCandidates after form is discovered', async () => {
    const faFn = FA_MOD.discoverFormAnchor as unknown as jest.Mock;
    const anchor = { selector: 'form#login' };
    faFn.mockResolvedValue(anchor);
    const scopeFn = FA_MOD.scopeCandidates as unknown as jest.Mock;
    const scopedCandidate = { kind: 'labelText' as const, value: 'scoped' };
    scopeFn.mockReturnValue([scopedCandidate]);
    const page = FACTORY.makeMockFullPage();
    const mediator = MED_MOD.createElementMediator(page);
    await mediator.discoverForm(RESOLVED_CTX);
    const candidates = [{ kind: 'labelText' as const, value: 'שם משתמש' }];
    const result = mediator.scopeToForm(candidates);
    expect(scopeFn).toHaveBeenCalled();
    expect(result).toEqual([scopedCandidate]);
  });
});
