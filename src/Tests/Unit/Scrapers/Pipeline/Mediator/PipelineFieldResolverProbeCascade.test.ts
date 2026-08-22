/**
 * Unit tests for the probe cascade's fillability vetting.
 *
 * Pins the tier-by-tier contract: a match the form-control guard rejects is
 * reported as a miss, so the later tiers still run. Vetting only the final
 * result would let the first wrong element — a text walk-up landing on a link
 * while the real input is still rendering — suppress the poll and the
 * positional heuristic that recover the field.
 *
 * The guard predicate itself is covered by PipelineFieldResolverFormControl;
 * here it is mocked so the tests speak only about cascade wiring.
 */

import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import type { IFieldContext } from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';

/** Selector a text walk-up lands on when the page is not the login form. */
const WALK_UP_ANCHOR = 'xpath=//a[.//text()[contains(., "תעודת זהות")]]';

/** Selector the positional heuristic hands back — a genuine credential input. */
const HEURISTIC_INPUT = '#realInput';

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js',
  () => ({
    probeIframes: jest.fn(),
    probeMainPage: jest.fn(),
    buildNotFoundContext: jest.fn(),
  }),
);

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Selector/HeuristicResolver.js',
  () => ({ tryHeuristicProbe: jest.fn() }),
);

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Selector/PipelineFieldResolver.formControl.js',
  () => ({ rejectNonFormControl: jest.fn() }),
);

const PIPE_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js');
const HEUR_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Selector/HeuristicResolver.js');
const GUARD_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Selector/PipelineFieldResolver.formControl.js');
const PROBE_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Selector/PipelineFieldResolver.probe.js');
const FACTORY = await import('../MockPipelineFactories.js');

const PROBE_MAIN = PIPE_MOD.probeMainPage as unknown as jest.Mock;
const PROBE_IFRAMES = PIPE_MOD.probeIframes as unknown as jest.Mock;
const NOT_FOUND_CTX = PIPE_MOD.buildNotFoundContext as unknown as jest.Mock;
const HEURISTIC = HEUR_MOD.tryHeuristicProbe as unknown as jest.Mock;
const REJECT = GUARD_MOD.rejectNonFormControl as unknown as jest.Mock;
const PROBE_ALL = PROBE_MOD.probeAll;

/** Shared mock context — never queried because every probe is mocked. */
const MOCK_CTX = FACTORY.makeMockFullPage() as Page | Frame;

/** Resolve options carrying only the field key the cascade reads. */
const OPTS = { field: { credentialKey: 'nationalID' } } as unknown as Parameters<
  typeof PROBE_ALL
>[1];

/**
 * Build a resolved field context for the given selector.
 * @param selector - Selector the probe claims to have resolved.
 * @returns A resolved IFieldContext.
 */
function resolved(selector: string): IFieldContext {
  return {
    isResolved: true,
    selector,
    context: MOCK_CTX,
    resolvedVia: 'wellKnown',
    round: 'mainPage',
  };
}

/** Not-resolved outcome the guard returns for a rejected element. */
const MISS: IFieldContext = {
  isResolved: false,
  selector: '',
  context: MOCK_CTX,
  resolvedVia: 'notResolved',
  round: 'notResolved',
};

/**
 * Stand-in guard: rejects the walk-up anchor, accepts everything else.
 * @param hit - Probe outcome to vet.
 * @returns The hit when fillable, a not-resolved outcome when not.
 */
function vetLikeGuard(hit: IFieldContext): IFieldContext {
  if (hit.selector === WALK_UP_ANCHOR) return MISS;
  return hit;
}

describe('probeAll cascade vetting', () => {
  beforeEach(() => {
    PROBE_MAIN.mockReset();
    PROBE_IFRAMES.mockReset();
    NOT_FOUND_CTX.mockReset();
    HEURISTIC.mockReset();
    REJECT.mockReset();
    REJECT.mockImplementation((hit: IFieldContext): IFieldContext => vetLikeGuard(hit));
    PROBE_IFRAMES.mockResolvedValue({});
  });

  it('falls through to the heuristic when the hot path lands on a non-fillable element', async () => {
    const anchorHit = resolved(WALK_UP_ANCHOR);
    const inputHit = resolved(HEURISTIC_INPUT);
    PROBE_MAIN.mockResolvedValue(anchorHit);
    HEURISTIC.mockResolvedValue(inputHit);
    const out = await PROBE_ALL(MOCK_CTX, OPTS);
    expect(out.isResolved).toBe(true);
    expect(out.selector).toBe(HEURISTIC_INPUT);
    expect(HEURISTIC).toHaveBeenCalledTimes(1);
  });

  it('returns the hot-path hit and skips the heuristic when it is fillable', async () => {
    const inputHit = resolved('#num');
    PROBE_MAIN.mockResolvedValue(inputHit);
    const out = await PROBE_ALL(MOCK_CTX, OPTS);
    expect(out.isResolved).toBe(true);
    expect(out.selector).toBe('#num');
    expect(HEURISTIC).not.toHaveBeenCalled();
  });

  it('vets the heuristic too, reporting not-found when it is also non-fillable', async () => {
    const anchorHit = resolved(WALK_UP_ANCHOR);
    PROBE_MAIN.mockResolvedValue(anchorHit);
    HEURISTIC.mockResolvedValue(anchorHit);
    NOT_FOUND_CTX.mockResolvedValue(MISS);
    const out = await PROBE_ALL(MOCK_CTX, OPTS);
    expect(out.isResolved).toBe(false);
    expect(NOT_FOUND_CTX).toHaveBeenCalledTimes(1);
  });
});
