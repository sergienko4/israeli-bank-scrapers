/**
 * Builder assembly — phase ordering and resolution logic.
 * Step resolvers in BuilderStepResolvers.ts.
 */

import type { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { SimplePhase } from '../../Types/SimplePhase.js';
import { createDashboardPhase } from '../Dashboard/DashboardPhase.js';
import { createFindLoginAreaPhase } from '../Home/FindLoginAreaPhase.js';
import { createHomePhase } from '../Home/HomePhase.js';
import { INIT_STEP } from '../Init/InitPhase.js';
import { OTP_STEP } from '../Otp/OtpPhase.js';
import { createScrapePhase } from '../Scrape/ScrapePhase.js';
import { TERMINATE_STEP } from '../Terminate/TerminatePhase.js';
import {
  buildLoginPhase,
  type IBuilderState,
  type LoginFn,
  resolveScrapeExec,
  type StepExecFn,
} from './BuilderStepResolvers.js';

type StepResult = Promise<Procedure<IPipelineContext>>;
type Ctx = IPipelineContext;

/**
 * Create a SimplePhase wrapping a step.
 * @param name - Phase name.
 * @param step - Pipeline step.
 * @returns BasePhase.
 */
function phaseFromStep(
  name: string,
  step: IPipelineStep<IPipelineContext, IPipelineContext>,
): BasePhase {
  /**
   * Delegate to step.
   * @param ctx - Context.
   * @param input - Input.
   * @returns Result.
   */
  const exec = (ctx: Ctx, input: Ctx): StepResult => step.execute(ctx, input);
  return Reflect.construct(SimplePhase, [name, exec]) as BasePhase;
}

/**
 * Build browser init phases.
 * @returns Init, home, FLA phases.
 */
function browserInitPhases(): readonly BasePhase[] {
  const initPhase = phaseFromStep('init', INIT_STEP);
  const homePhase = createHomePhase();
  const flaPhase = createFindLoginAreaPhase();
  return [initPhase, homePhase, flaPhase];
}

/**
 * Build OTP phase if configured.
 * @param state - Builder state.
 * @returns OTP phase array (0 or 1 element).
 */
function buildOtpPhase(state: IBuilderState): readonly BasePhase[] {
  if (!state.hasOtp) return [];
  return [phaseFromStep('otp', OTP_STEP)];
}

/**
 * Build dashboard phase if browser is enabled.
 * @param state - Builder state.
 * @returns Dashboard phase array (0 or 1 element).
 */
function buildDashPhase(state: IBuilderState): readonly BasePhase[] {
  if (!state.hasBrowser) return [];
  return [createDashboardPhase()];
}

/**
 * Build scrape phase if any scraper is configured.
 * @param state - Builder state.
 * @returns Scrape phase array (0 or 1 element).
 */
function buildScrapePhaseArr(state: IBuilderState): readonly BasePhase[] {
  const hasScraper = state.scrapeFn || state.scrapeConfig || state.hasBrowser;
  if (!hasScraper) return [];
  const scrapeExec = resolveScrapeExec(state);
  return [createScrapePhase(scrapeExec)];
}

/**
 * Build optional phases (otp, dashboard, scrape).
 * @param state - Builder state.
 * @returns Optional phases array.
 */
function optionalPhases(state: IBuilderState): readonly BasePhase[] {
  return [...buildOtpPhase(state), ...buildDashPhase(state), ...buildScrapePhaseArr(state)];
}

/**
 * Assemble all phases in order.
 * @param state - Builder state.
 * @returns Ordered phase array.
 */
function assemblePhases(state: IBuilderState): BasePhase[] {
  const phases: BasePhase[] = [];
  if (state.hasBrowser) phases.push(...browserInitPhases());
  const loginPhase = buildLoginPhase(state);
  phases.push(loginPhase);
  phases.push(...optionalPhases(state));
  if (state.hasBrowser) {
    const term = phaseFromStep('terminate', TERMINATE_STEP);
    phases.push(term);
  }
  return phases;
}

export type { IBuilderState, LoginFn, StepExecFn };
export { assemblePhases };
