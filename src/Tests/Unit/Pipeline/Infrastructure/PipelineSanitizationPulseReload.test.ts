/**
 * Reload-before-retry tests for PipelineSanitizationPulse.
 *
 * <p>Re-running interceptors cannot re-bootstrap a page, so a phase that
 * failed because its SPA never hydrated could not recover from a retry that
 * re-queried the same dead document. These tests pin the reload that makes
 * recovery possible, and pin that every phase outside the opt-in set still
 * retries exactly as it did before.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { sanitizationPulse } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineSanitizationPulse.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Phases/Base/BasePhase.js';
import type { IPipelineInterceptor } from '../../../../Scrapers/Pipeline/Types/Interceptor.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from './MockFactories.js';

/** URL the mock page reports itself to be on. */
const CURRENT_URL = 'https://bank.test/login';

/** Base URL the mock context's bank config carries. */
const BANK_BASE_URL = 'https://test.bank';

/** Records the navigations a pulse performed. */
interface IReloadProbe {
  readonly navigations: string[];
  readonly navOptions: unknown[];
}

/**
 * Build a fresh navigation probe.
 * @returns Probe with an empty navigation log.
 */
function makeProbe(): IReloadProbe {
  return { navigations: [], navOptions: [] };
}

/**
 * Build a phase that fails until the page has been reloaded at least once.
 *
 * <p>Models a non-bootstrapped SPA: the DOM the phase queries is empty, and
 * only a fresh document can make the phase pass.
 * @param name - Phase name the pulse will look up in its opt-in set.
 * @param probe - Navigation log consulted to decide the outcome.
 * @returns Phase stub whose success depends on a prior reload.
 */
function makeBootstrapDependentPhase(name: PhaseName, probe: IReloadProbe): BasePhase {
  return {
    name,
    /**
     * Succeed only once a reload has happened.
     * @param ctx - Pipeline context.
     * @returns Success after a reload, failure before one.
     */
    run: (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
      const hasReloaded = probe.navigations.length > 0;
      const outcome = hasReloaded
        ? succeed(ctx)
        : fail(ScraperErrorTypes.Generic, 'PRE-LOGIN: no password field');
      return Promise.resolve(outcome);
    },
  } as unknown as BasePhase;
}

/**
 * Build a mediator that logs every navigation it is asked to perform.
 * @param probe - Navigation log to append to.
 * @param outcome - Whether the navigation reports success or failure.
 * @param currentUrl - URL the mock page reports itself to be on.
 * @returns Mock mediator recording navigations.
 */
function makeRecordingMediator(
  probe: IReloadProbe,
  outcome: 'ok' | 'fail',
  currentUrl: string,
): IElementMediator {
  /**
   * Record the navigation and report the scripted outcome.
   * @param url - Target URL.
   * @param options - Wait condition and budget the caller asked for.
   * @returns Navigation procedure.
   */
  const navigateTo: IElementMediator['navigateTo'] = (url, options) => {
    probe.navigations.push(url);
    probe.navOptions.push(options);
    const nav =
      outcome === 'ok' ? succeed(undefined) : fail(ScraperErrorTypes.Generic, 'nav failed');
    return Promise.resolve(nav);
  };
  /**
   * Report the URL the mock page is on.
   * @returns The scripted current URL.
   */
  const getCurrentUrl: IElementMediator['getCurrentUrl'] = () => currentUrl;
  return makeMockMediator({ navigateTo, getCurrentUrl });
}

/**
 * Build an interceptor chain that always passes the context through.
 * @returns Pass-through interceptor.
 */
function makePassingInterceptor(): IPipelineInterceptor {
  return {
    /**
     * Pass the context through untouched.
     * @param ctx - Pipeline context.
     * @returns The same context.
     */
    beforePhase: (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
      const passed = succeed(ctx);
      return Promise.resolve(passed);
    },
    /**
     * Unused by the pulse.
     * @returns Empty success.
     */
    afterPipeline: (): Promise<Procedure<IPipelineContext>> => {
      const empty = succeed({} as IPipelineContext);
      return Promise.resolve(empty);
    },
  } as unknown as IPipelineInterceptor;
}

/** Inputs a pulse run needs, assembled per test. */
interface IPulseCase {
  readonly phase: PhaseName;
  readonly navOutcome: 'ok' | 'fail';
  readonly hasMediator?: boolean;
  /** URL the page reports; defaults to a login URL off the bank's base origin. */
  readonly currentUrl?: string;
}

/**
 * Drive one sanitization pulse against a bootstrap-dependent phase.
 * @param testCase - Phase under test plus the navigation outcome to script.
 * @returns The pulse result and the navigation log it produced.
 */
async function runPulse(
  testCase: IPulseCase,
): Promise<{ result: IPipelineContext | false; probe: IReloadProbe }> {
  const probe = makeProbe();
  const url = testCase.currentUrl ?? CURRENT_URL;
  const mediator = makeRecordingMediator(probe, testCase.navOutcome, url);
  const isAttached = testCase.hasMediator !== false;
  const ctx = makeMockContext(isAttached ? { mediator: some(mediator) } : {});
  const tracker = {
    phases: [makeBootstrapDependentPhase(testCase.phase, probe)] as readonly BasePhase[],
    interceptors: [makePassingInterceptor()] as readonly IPipelineInterceptor[],
    lastCtx: ctx,
  };
  const step = { name: testCase.phase, tag: '1/1', index: 0 };
  const result = await sanitizationPulse({ tracker, ctx, step });
  return { result, probe };
}

describe('PipelineSanitizationPulse — reload before retry', () => {
  it('reloads before retrying pre-login so a dead SPA can recover', async () => {
    const { result, probe } = await runPulse({ phase: 'pre-login', navOutcome: 'ok' });
    expect(probe.navigations).toEqual([CURRENT_URL]);
    expect(result).not.toBe(false);
  });

  it('spends the reload within the existing single-pulse budget', async () => {
    const { probe } = await runPulse({ phase: 'pre-login', navOutcome: 'ok' });
    expect(probe.navigations).toHaveLength(1);
  });

  it('waits for a document mount, not for every subresource', async () => {
    const { probe } = await runPulse({ phase: 'pre-login', navOutcome: 'ok' });
    const expected = [{ waitUntil: 'domcontentloaded', timeout: 30_000 }];
    expect(probe.navOptions).toEqual(expected);
  });

  it('leaves a phase outside the opt-in set retrying without a reload', async () => {
    const { result, probe } = await runPulse({ phase: 'login', navOutcome: 'ok' });
    expect(probe.navigations).toEqual([]);
    expect(result).toBe(false);
  });

  it('still runs the retry when the reload itself fails', async () => {
    const { result, probe } = await runPulse({ phase: 'pre-login', navOutcome: 'fail' });
    expect(probe.navigations).toEqual([CURRENT_URL]);
    expect(result).not.toBe(false);
  });

  it('skips the reload when the context carries no mediator', async () => {
    const testCase = { phase: 'pre-login' as const, navOutcome: 'ok' as const, hasMediator: false };
    const { result, probe } = await runPulse(testCase);
    expect(probe.navigations).toEqual([]);
    expect(result).toBe(false);
  });
});

/**
 * HOME's reload is gated on still being on the bank's own site.
 *
 * <p>Discount's edge served the bank's branded 404 for the homepage. Both HOME
 * pulses then re-queried that one frozen document — proved by the page's
 * per-response reference number being identical in the INIT screenshot and in
 * the last HOME failure 18 s later. Reloading is the only thing that could have
 * recovered it, and a later attempt of the same job did succeed.
 *
 * <p>The gate matters because a pulse retries the WHOLE phase. Once HOME.ACTION
 * has navigated to the login page, reloading there would re-run home discovery
 * against a page that never had a home login link.
 */
describe('PipelineSanitizationPulse — home reload gate', () => {
  it('reloads before retrying home while still on the bank site', async () => {
    const homeCase = {
      phase: 'home' as const,
      navOutcome: 'ok' as const,
      currentUrl: BANK_BASE_URL,
    };
    const { result, probe } = await runPulse(homeCase);
    expect(probe.navigations).toEqual([BANK_BASE_URL]);
    expect(result).not.toBe(false);
  });

  it('reloads where the page actually is after a canonicalising redirect', async () => {
    const landed = `${BANK_BASE_URL}/he/`;
    const { probe } = await runPulse({ phase: 'home', navOutcome: 'ok', currentUrl: landed });
    expect(probe.navigations).toEqual([landed]);
  });

  it('does not reload once home has navigated off the bank site', async () => {
    const { probe } = await runPulse({ phase: 'home', navOutcome: 'ok', currentUrl: CURRENT_URL });
    expect(probe.navigations).toEqual([]);
  });

  it('does not reload when the current URL is unreadable', async () => {
    const { probe } = await runPulse({
      phase: 'home',
      navOutcome: 'ok',
      currentUrl: 'about:blank',
    });
    expect(probe.navigations).toEqual([]);
  });

  it('spends the reload inside home\u2019s existing two-pulse budget', async () => {
    const homeCase = {
      phase: 'home' as const,
      navOutcome: 'ok' as const,
      currentUrl: BANK_BASE_URL,
    };
    const { probe } = await runPulse(homeCase);
    expect(probe.navigations).toHaveLength(1);
  });
});
