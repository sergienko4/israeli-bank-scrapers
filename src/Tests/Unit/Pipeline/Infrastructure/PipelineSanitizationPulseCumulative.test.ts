/**
 * Cumulative-state tests for PipelineSanitizationPulse.
 *
 * <p>A two-pulse phase recovers by accumulating progress: the first pulse
 * clears an obstruction, and the second consumes what that cleared. The thing
 * carrying that progress between pulses is the live document, so anything that
 * discards it — a pre-retry reload above all — makes the second pulse repeat
 * the first instead of building on it, and the budget expires one move short.
 *
 * <p>HOME is the phase that proved it. Its first pulse clicks a menu toggle
 * open; only the second sees the login link that click revealed. These tests
 * pin that contract, so extending the reload set can never silently cost a
 * phase the progress its next pulse depends on.
 *
 * <p>The budget itself is pinned elsewhere, by T-PULSE-1 and T-PULSE-2 in
 * `PipelineReducerHomePulse.test.ts`; what is asserted here is only the
 * consequence a reload would destroy.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IContextTracker } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineMiddleware.js';
import { sanitizationPulse } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineSanitizationPulse.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Phases/Base/BasePhase.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from './MockFactories.js';

/** Phase granted a second pulse, so progress can span pulses. */
const TWO_PULSE_PHASE: PhaseName = 'home';

/**
 * URL the mock page reports itself to be on. It deliberately shares an origin
 * with the base URL {@link makeMockContext} configures, so a reload guarded by
 * "only while still on the bank's site" is genuinely exercised here rather
 * than short-circuited by an off-origin page into a silent pass.
 */
const CURRENT_URL = 'https://test.bank/home';

/** Live-document state that a pulse can build on — or destroy. */
interface IMenuProbe {
  /** True once a trigger click has opened the menu. */
  menuOpen: boolean;
  /** The value of {@link IMenuProbe.menuOpen} seen by each phase attempt. */
  readonly attempts: boolean[];
  /** Every navigation the pulse performed. */
  readonly navigations: string[];
}

/**
 * Build a fresh probe with the menu closed.
 * @returns Probe recording attempts and navigations.
 */
function makeMenuProbe(): IMenuProbe {
  return { menuOpen: false, attempts: [], navigations: [] };
}

/**
 * Attempt the phase against the live document, modelling HOME: the first
 * attempt only opens the menu, and a later attempt consumes it.
 * @param probe - Live-document state.
 * @param ctx - Pipeline context returned on success.
 * @returns Success once the menu is open, failure while it is closed.
 */
function attemptMenuPhase(probe: IMenuProbe, ctx: IPipelineContext): Procedure<IPipelineContext> {
  probe.attempts.push(probe.menuOpen);
  if (probe.menuOpen) return succeed(ctx);
  probe.menuOpen = true;
  return fail(ScraperErrorTypes.Generic, 'HOME: trigger clicked, no login area yet');
}

/**
 * Build a phase that recovers only once a previous attempt opened the menu.
 * @param name - Phase name the pulse looks up in its budget set.
 * @param probe - Live-document state shared with the mediator.
 * @returns Phase stub whose success depends on accumulated state.
 */
function makeMenuDependentPhase(name: PhaseName, probe: IMenuProbe): BasePhase {
  /**
   * Retry the phase against the live document.
   * @param ctx - Pipeline context.
   * @returns Outcome for this attempt.
   */
  const run = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
    const outcome = attemptMenuPhase(probe, ctx);
    return Promise.resolve(outcome);
  };
  return { name, run } as unknown as BasePhase;
}

/**
 * Build a mediator whose navigation destroys the open menu, exactly as a real
 * reload discards the document the previous pulse mutated.
 * @param probe - Live-document state to reset on navigation.
 * @returns Mock mediator recording navigations.
 */
function makeReloadingMediator(probe: IMenuProbe): IElementMediator {
  /**
   * Record the navigation and discard the open menu.
   * @param url - Target URL.
   * @returns Successful navigation.
   */
  const navigateTo: IElementMediator['navigateTo'] = url => {
    probe.navigations.push(url);
    probe.menuOpen = false;
    const nav = succeed(undefined);
    return Promise.resolve(nav);
  };
  /**
   * Report the URL the mock page is on.
   * @returns The fixed current URL.
   */
  const getCurrentUrl: IElementMediator['getCurrentUrl'] = () => CURRENT_URL;
  return makeMockMediator({ navigateTo, getCurrentUrl });
}

/**
 * Build the context the pulse runs against, sharing the probe with the phase.
 * @param probe - Live-document state.
 * @returns Context carrying a mediator whose navigation resets that state.
 */
function makeMenuContext(probe: IMenuProbe): IPipelineContext {
  const mediator = makeReloadingMediator(probe);
  return makeMockContext({ mediator: some(mediator) });
}

/**
 * Drive one sanitization pulse against a state-dependent phase. The
 * interceptor list is empty because {@link makeMockContext} leaves the browser
 * absent, and the pulse skips interceptors entirely without one — so a
 * populated list would be inert setup implying coverage this does not have.
 * @param phase - Phase name the pulse looks up in its budget set.
 * @param probe - Live-document state to share with phase and mediator.
 * @returns Recovered context, or false when every pulse failed.
 */
async function runMenuPulse(
  phase: PhaseName,
  probe: IMenuProbe,
): Promise<IPipelineContext | false> {
  const ctx = makeMenuContext(probe);
  const phases = [makeMenuDependentPhase(phase, probe)] as readonly BasePhase[];
  const tracker: IContextTracker = { phases, interceptors: [], lastCtx: ctx };
  const step = { name: phase, tag: '1/1', index: 0 };
  return sanitizationPulse({ tracker, ctx, step });
}

describe('PipelineSanitizationPulse — cumulative state across pulses', () => {
  it('recovers on the second pulse by building on what the first cleared', async () => {
    const probe = makeMenuProbe();
    const result = await runMenuPulse(TWO_PULSE_PHASE, probe);
    expect(probe.attempts).toEqual([false, true]);
    expect(result).not.toBe(false);
  });

  it('never navigates between pulses of a two-pulse phase, so progress survives', async () => {
    const probe = makeMenuProbe();
    await runMenuPulse(TWO_PULSE_PHASE, probe);
    expect(probe.navigations).toEqual([]);
  });
});
