/**
 * Pipeline assembly — phase ordering and resolution logic.
 * Step resolvers in StepResolvers.ts.
 */

import { createAccountResolvePhase } from '../../Phases/AccountResolve/AccountResolvePhase.js';
import { createDashboardPhase } from '../../Phases/Dashboard/DashboardPhase.js';
import { createHomePhase } from '../../Phases/Home/HomePhase.js';
import { createInitPhase } from '../../Phases/Init/InitPhase.js';
import { createOtpFillPhase } from '../../Phases/OtpFill/OtpFillPhase.js';
import { createOtpTriggerPhase } from '../../Phases/OtpTrigger/OtpTriggerPhase.js';
import { createPreLoginPhase } from '../../Phases/PreLogin/FindLoginAreaPhase.js';
import { createScrapePhase } from '../../Phases/Scrape/ScrapePhase.js';
import { createTerminatePhase } from '../../Phases/Terminate/TerminatePhase.js';
import type { BasePhase } from '../../Types/BasePhase.js';
import { buildLoginPhase, type IBuilderState, resolveScrapeExec } from './StepResolvers.js';

/**
 * Build browser init phases — Init + Home are always-on for browser
 * banks. PRE-LOGIN is opt-in via `.withPreLogin()` on the builder.
 * @param state - Builder state (for hasPreLogin flag).
 * @returns Init, Home, [PreLogin?] phases.
 */
function browserInitPhases(state: IBuilderState): readonly BasePhase[] {
  const initPhase = createInitPhase();
  const homePhase = createHomePhase();
  const preLoginPhases = state.hasPreLogin && [createPreLoginPhase()];
  return [initPhase, homePhase, ...(preLoginPhases || [])];
}

/**
 * Build OTP phases — trigger (optional) + fill.
 * Trigger phase only added when builder chain includes withOtpTrigger().
 * @param state - Builder state.
 * @returns OTP phase array (0, 1, or 2 elements).
 */
function buildOtpPhases(state: IBuilderState): readonly BasePhase[] {
  if (!state.hasOtpFill) return [];
  const trigger = state.hasOtpTrigger && [createOtpTriggerPhase()];
  return [...(trigger || []), createOtpFillPhase(state.otpFillRequired)];
}

/**
 * Build the ACCOUNT-RESOLVE phase — auto-bound for every browser bank.
 * Single source of truth for `ctx.accountDiscovery`; the LOGIN /
 * OTP-FILL FINALs are pure auth-signal probes after Phase 7. Empty
 * array for headless / api-direct pipelines (no browser → no captures
 * to inspect).
 * @param state - Builder state.
 * @returns ACCOUNT-RESOLVE phase array (0 or 1 element).
 */
function buildAccountResolvePhase(state: IBuilderState): readonly BasePhase[] {
  if (!state.hasBrowser) return [];
  return [createAccountResolvePhase()];
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
  const hasScraper = state.scrapeFn || state.hasBrowser;
  if (!hasScraper) return [];
  const scrapeExec = resolveScrapeExec(state);
  return [createScrapePhase(scrapeExec)];
}

/**
 * Build optional phases (otp, account-resolve, dashboard, scrape).
 * ACCOUNT-RESOLVE sits AFTER auth (LOGIN or OTP-FILL) and BEFORE
 * DASHBOARD so the dashboard click never fires before account ids
 * are committed to context.
 * @param state - Builder state.
 * @returns Optional phases array.
 */
function optionalPhases(state: IBuilderState): readonly BasePhase[] {
  return [
    ...buildOtpPhases(state),
    ...buildAccountResolvePhase(state),
    ...buildDashPhase(state),
    ...buildScrapePhaseArr(state),
  ];
}

/**
 * Assemble all phases in order.
 * @param state - Builder state.
 * @returns Ordered phase array.
 */
/**
 * Build the leading browser-init slice (Init/Home/PreLogin) for browser
 * pipelines, or empty for headless ones. Pulled out to keep
 * `assemblePhases` flat and ternary-free per the project lint rules.
 * @param state - Builder state.
 * @returns Init slice — empty when `hasBrowser` is false.
 */
function leadingInit(state: IBuilderState): readonly BasePhase[] {
  if (!state.hasBrowser) return [];
  return browserInitPhases(state);
}

/**
 * Build the trailing terminate slice for browser pipelines, or empty.
 * @param state - Builder state.
 * @returns Terminate slice — empty when `hasBrowser` is false.
 */
function trailingTerminate(state: IBuilderState): readonly BasePhase[] {
  if (!state.hasBrowser) return [];
  return [createTerminatePhase()];
}

/**
 * Assemble the ordered phase list from the validated builder state.
 * @param state - Builder state.
 * @returns Ordered phase array.
 */
function assemblePhases(state: IBuilderState): BasePhase[] {
  const init = leadingInit(state);
  const loginPhase = buildLoginPhase(state);
  const optional = optionalPhases(state);
  const terminate = trailingTerminate(state);
  return [...init, loginPhase, ...optional, ...terminate];
}

export type { IBuilderState, LoginFn, StepExecFn } from './StepResolvers.js';
export { assemblePhases };
