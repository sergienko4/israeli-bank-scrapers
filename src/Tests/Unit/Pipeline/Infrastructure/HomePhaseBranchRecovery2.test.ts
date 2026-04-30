/**
 * Branch recovery tests for HomePhase — guard-path coverage.
 * Targets: line 36 (no browser in PRE), line 39 (PRE resolveHomeStrategy fail),
 * line 62 (no mediator in POST), line 78 (no mediator in FINAL).
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { HomePhase } from '../../../../Scrapers/Pipeline/Phases/Home/HomePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from './MockFactories.js';

/**
 * Fresh HomePhase instance per test (so _discovery cache isolates).
 * @returns Result.
 */
function freshPhase(): HomePhase {
  return new HomePhase();
}

describe('HomePhase PRE — guard branches', () => {
  it('fails when mediator present but browser missing (line 36)', async () => {
    const mediator = makeMockMediator();
    const ctx = makeMockContext({ mediator: some(mediator) });
    const phase = freshPhase();
    const result = await phase.pre(ctx, ctx);
    const isOkFlag = isOk(result);
    expect(isOkFlag).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('HOME PRE');
    }
  });
});

describe('HomePhase POST — guard branches', () => {
  it('fails when mediator missing in POST (line 62)', async () => {
    const ctx = makeMockContext();
    const phase = freshPhase();
    const result = await phase.post(ctx, ctx);
    const isOkFlag = isOk(result);
    expect(isOkFlag).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('HOME POST');
    }
  });
});

describe('HomePhase FINAL — guard branches', () => {
  it('fails when mediator missing in FINAL (line 78)', async () => {
    const ctx = makeMockContext();
    const phase = freshPhase();
    const result = await phase.final(ctx, ctx);
    const isOkFlag = isOk(result);
    expect(isOkFlag).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('HOME FINAL');
    }
  });
});
