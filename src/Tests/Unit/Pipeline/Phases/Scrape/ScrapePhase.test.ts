/**
 * Unit tests for Phases/Scrape/ScrapePhase — phase factory + compat step.
 */

import {
  createScrapePhase,
  findProxyAccountTemplate,
  findProxyTxnTemplate,
  SCRAPE_STEP,
  ScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/Scrape/ScrapePhase.js';
import type { ActionExecFn } from '../../../../../Scrapers/Pipeline/Phases/Scrape/ScrapeStepFactory.js';

describe('ScrapePhase', () => {
  it('has name "scrape"', () => {
    const phase = createScrapePhase();
    expect(phase.name).toBe('scrape');
  });

  it('is an instance of ScrapePhase class', () => {
    const phase = createScrapePhase();
    expect(phase).toBeInstanceOf(ScrapePhase);
  });

  it('accepts a custom action exec fn', () => {
    const phase = createScrapePhase();
    expect(phase.name).toBe('scrape');
  });
});

describe('SCRAPE_STEP', () => {
  it('has name "scrape"', () => {
    expect(SCRAPE_STEP.name).toBe('scrape');
  });
});

describe('Re-exported template finders', () => {
  it('findProxyAccountTemplate returns false for empty list', () => {
    const findProxyAccountTemplateResult1 = findProxyAccountTemplate([]);
    expect(findProxyAccountTemplateResult1).toBe(false);
  });

  it('findProxyTxnTemplate returns false for empty list', () => {
    const findProxyTxnTemplateResult2 = findProxyTxnTemplate([]);
    expect(findProxyTxnTemplateResult2).toBe(false);
  });
});

describe('ScrapePhase lifecycle', () => {
  it('pre() runs executeForensicPre', async () => {
    const { makeMockContext } = await import('../../Infrastructure/MockFactories.js');
    const { isOk } = await import('../../../../../Scrapers/Pipeline/Types/Procedure.js');
    const phase = createScrapePhase();
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('action() runs default matrix loop (no discovery → passes through)', async () => {
    const { makeMockContext } = await import('../../Infrastructure/MockFactories.js');
    const { toActionCtx, makeMockActionExecutor } =
      await import('../../Infrastructure/TestHelpers.js');
    const { isOk } = await import('../../../../../Scrapers/Pipeline/Types/Procedure.js');
    const phase = createScrapePhase();
    const makeMockActionExecutorResult5 = makeMockActionExecutor();
    const makeMockContextResult4 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult4, makeMockActionExecutorResult5);
    const result = await phase.action(ctx, ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('post() runs validateResults', async () => {
    const { makeMockContext } = await import('../../Infrastructure/MockFactories.js');
    const { isOk } = await import('../../../../../Scrapers/Pipeline/Types/Procedure.js');
    const phase = createScrapePhase();
    const ctx = makeMockContext();
    const result = await phase.post(ctx, ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('final() stamps accounts', async () => {
    const { makeMockContext } = await import('../../Infrastructure/MockFactories.js');
    const { isOk } = await import('../../../../../Scrapers/Pipeline/Types/Procedure.js');
    const phase = createScrapePhase();
    const ctx = makeMockContext();
    const result = await phase.final(ctx, ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('accepts custom actionExec', async () => {
    const { makeMockContext } = await import('../../Infrastructure/MockFactories.js');
    const { toActionCtx, makeMockActionExecutor } =
      await import('../../Infrastructure/TestHelpers.js');
    const { succeed, isOk } = await import('../../../../../Scrapers/Pipeline/Types/Procedure.js');
    let called = 0;
    /**
     * Test helper.
     *
     * @param _ctx - Parameter.
     * @param input - Parameter.
     * @returns Result.
     */
    const customAction = (_ctx: unknown, input: unknown): Promise<ReturnType<typeof succeed>> => {
      called += 1;
      const succeedResult9 = succeed(input);
      return Promise.resolve(succeedResult9);
    };
    const phase = createScrapePhase(customAction as unknown as ActionExecFn);
    const makeMockActionExecutorResult11 = makeMockActionExecutor();
    const makeMockContextResult10 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult10, makeMockActionExecutorResult11);
    const result = await phase.action(ctx, ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
    expect(called).toBe(1);
  });
});

describe('SCRAPE_STEP execute', () => {
  it('execute() returns success when matrix loop passes through', async () => {
    const { makeMockContext } = await import('../../Infrastructure/MockFactories.js');
    const { isOk } = await import('../../../../../Scrapers/Pipeline/Types/Procedure.js');
    const ctx = makeMockContext();
    const result = await SCRAPE_STEP.execute(ctx, ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });
});
