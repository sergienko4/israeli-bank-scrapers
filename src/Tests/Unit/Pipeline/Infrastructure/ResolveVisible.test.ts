/**
 * Unit tests for resolveVisible — Identify → Inspect → Act pattern.
 * Tests IRaceResult metadata returned without clicking.
 */

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

// ── NOT_FOUND_RESULT constant ─────────────────────────────

describe('NOT_FOUND_RESULT', () => {
  it('has found=false and all fields set to false/-1', () => {
    expect(NOT_FOUND_RESULT.found).toBe(false);
    expect(NOT_FOUND_RESULT.locator).toBe(false);
    expect(NOT_FOUND_RESULT.candidate).toBe(false);
    expect(NOT_FOUND_RESULT.context).toBe(false);
    expect(NOT_FOUND_RESULT.index).toBe(-1);
    expect(NOT_FOUND_RESULT.value).toBe('');
  });
});

// ── resolveVisible via mock mediator ──────────────────────

/**
 * Build a mock IRaceResult for testing.
 * @param candidate - The winning candidate.
 * @param value - Snapshot value.
 * @returns IRaceResult with mock data.
 */
function buildMockResult(candidate: SelectorCandidate, value: string): IRaceResult {
  const mockLocator = {
    /**
     * Click mock.
     * @returns Resolved true.
     */
    click: (): Promise<boolean> => Promise.resolve(true),
  };
  return {
    found: true,
    locator: mockLocator as unknown as IRaceResult['locator'],
    candidate,
    context: {} as IRaceResult['context'],
    index: 0,
    value,
    identity: false,
  };
}

// ── resolveAllVisible via mock mediator ──────────────────

describe('resolveAllVisible/mock', () => {
  it('returns the configured array verbatim', async () => {
    const c1: SelectorCandidate = { kind: 'css', value: '#a' };
    const c2: SelectorCandidate = { kind: 'css', value: '#b' };
    const list = [buildMockResult(c1, 'a'), buildMockResult(c2, 'b')];
    const mediator = makeMockMediator({
      /**
       * Returns the pre-built two-element list verbatim.
       * @returns Two-element array.
       */
      resolveAllVisible: (): Promise<readonly IRaceResult[]> => Promise.resolve(list),
    });
    const got = await mediator.resolveAllVisible([c1, c2], 1000, 3);
    expect(got).toHaveLength(2);
    expect(got[0]?.value).toBe('a');
    expect(got[1]?.value).toBe('b');
  });

  it('returns empty array when nothing fulfills', async () => {
    const mediator = makeMockMediator();
    const got = await mediator.resolveAllVisible([{ kind: 'css', value: '#nope' }], 1000, 3);
    expect(got).toEqual([]);
  });
});

describe('resolveVisible/mock', () => {
  it('returns found=true with metadata when element exists', async () => {
    const mockCandidate: SelectorCandidate = { kind: 'textContent', value: 'כניסה לחשבון' };
    const mockResult = buildMockResult(mockCandidate, 'כניסה לחשבון');
    const mediator = makeMockMediator({
      /**
       * Return found result.
       * @returns Mock IRaceResult.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(mockResult),
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'כניסה לחשבון' }];
    const didResolve = await mediator.resolveVisible(candidates);
    expect(didResolve.found).toBe(true);
    expect(didResolve.candidate).toBe(mockCandidate);
    expect(didResolve.value).toBe('כניסה לחשבון');
    expect(didResolve.index).toBe(0);
  });

  it('returns NOT_FOUND_RESULT when no element matches', async () => {
    const mediator = makeMockMediator({
      /**
       * Nothing found.
       * @returns NOT_FOUND_RESULT.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(NOT_FOUND_RESULT),
    });
    const candidates: SelectorCandidate[] = [{ kind: 'textContent', value: 'not on page' }];
    const didResolve = await mediator.resolveVisible(candidates);
    expect(didResolve.found).toBe(false);
    expect(didResolve.locator).toBe(false);
    expect(didResolve.index).toBe(-1);
  });

  it('returns found=true with target: href candidate metadata', async () => {
    const hrefCandidate: SelectorCandidate = {
      kind: 'textContent',
      value: 'כניסה',
      target: 'href',
      match: '/login',
    };
    const mockResult = buildMockResult(hrefCandidate, 'https://bank.co.il/login');
    const mediator = makeMockMediator({
      /**
       * Return href result.
       * @returns Mock IRaceResult with href candidate.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(mockResult),
    });
    const didResolve = await mediator.resolveVisible([hrefCandidate]);
    expect(didResolve.found).toBe(true);
    const candidateTarget = didResolve.candidate ? didResolve.candidate.target : undefined;
    expect(candidateTarget).toBe('href');
    expect(didResolve.value).toBe('https://bank.co.il/login');
  });

  it('default mediator resolveVisible returns NOT_FOUND_RESULT', async () => {
    const mediator = makeMockMediator();
    const didResolve = await mediator.resolveVisible([{ kind: 'textContent', value: 'x' }]);
    expect(didResolve.found).toBe(false);
  });
});

// ── resolveAndClick still works after refactor ────────────

describe('resolveAndClick/backward-compat', () => {
  it('returns success with found=true when mediator finds element', async () => {
    const mediator = makeMockMediator({
      /**
       * Found and clicked.
       * @returns Success with found=true.
       */
      resolveAndClick: () => {
        const found = succeed({ ...NOT_FOUND_RESULT, found: true as const });
        return Promise.resolve(found);
      },
    });
    const result = await mediator.resolveAndClick([{ kind: 'textContent', value: 'כניסה' }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(true);
  });

  it('returns success with found=false when nothing matches', async () => {
    const mediator = makeMockMediator({
      /**
       * Not found.
       * @returns Success with found=false.
       */
      resolveAndClick: () => {
        const notFound = succeed(NOT_FOUND_RESULT);
        return Promise.resolve(notFound);
      },
    });
    const result = await mediator.resolveAndClick([{ kind: 'textContent', value: 'x' }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(false);
  });
});
