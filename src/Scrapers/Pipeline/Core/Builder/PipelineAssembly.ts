/**
 * Pipeline assembly — phase ordering and resolution logic.
 * Step resolvers in StepResolvers.ts.
 */

import { createDashboardPhase } from '../../Phases/Dashboard/DashboardPhase.js';
import { createHomePhase } from '../../Phases/Home/HomePhase.js';
import { createInitPhase } from '../../Phases/Init/InitPhase.js';
import { createOtpFillPhase } from '../../Phases/OtpFill/OtpFillPhase.js';
import { createOtpTriggerPhase } from '../../Phases/OtpTrigger/OtpTriggerPhase.js';
import { createPreLoginPhase } from '../../Phases/PreLogin/FindLoginAreaPhase.js';
import { createScrapePhase } from '../../Phases/Scrape/ScrapePhase.js';
import { createTerminatePhase } from '../../Phases/Terminate/TerminatePhase.js';
import type { BasePhase } from '../../Types/BasePhase.js';
import {
  buildLoginPhase,
  type IBuilderState,
  type LoginFn,
  resolveScrapeExec,
  type StepExecFn,
} from './StepResolvers.js';

/**
 * Build browser init phases.
 * @returns Init, home, FLA phases.
 */
function browserInitPhases(): readonly BasePhase[] {
  const initPhase = createInitPhase();
  const homePhase = createHomePhase();
  const flaPhase = createPreLoginPhase();
  return [initPhase, homePhase, flaPhase];
}

/**
 * Build OTP phases — trigger (optional) + fill.
 * Trigger phase only added when builder chain includes withLoginAndOtpTrigger().
 * @param state - Builder state.
 * @returns OTP phase array (0, 1, or 2 elements).
 */
function buildOtpPhases(state: IBuilderState): readonly BasePhase[] {
  if (!state.hasOtp) return [];
  const trigger = state.hasOtpTrigger && [createOtpTriggerPhase()];
  return [...(trigger || []), createOtpFillPhase()];
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
  return [...buildOtpPhases(state), ...buildDashPhase(state), ...buildScrapePhaseArr(state)];
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
    const term = createTerminatePhase();
    phases.push(term);
  }
  return phases;
}

export type { IBuilderState, LoginFn, StepExecFn };
export { assemblePhases };
