/**
 * Pipeline assembly — declarative phase chain composition.
 *
 * <p>Single source of truth for the order of pipeline phases. The
 * 11-slot chain below pairs each phase factory with a one-line
 * predicate against {@link IBuilderState}; {@link assemblePhases}
 * walks the chain once and returns the BasePhase list.
 *
 * <p>This file imports ONLY the per-phase factory functions
 * (`create*Phase`) and the shared {@link buildLoginPhase} +
 * {@link resolveScrapeExec} helpers from {@link StepResolvers}. It
 * does NOT import any phase-mediator action handler — phase logic
 * stays sealed behind each phase's `BasePhase.run()` method.
 * Architecture rules R-AUTH-DISCOVERY-OWN (Mission 1) and
 * R-LOGIN-SEAL / R-OTP-*-SEAL (Missions 2/3/4) enforce that seal
 * at compile time.
 *
 * <p>No hidden cross-phase backdoors: phases never reach into each
 * other's mediator zones, never share WK dictionaries beyond the
 * existing phase-7d/7e/7f rules, and communicate only via the slim
 * value-typed `Option<...>` fields on {@link IPipelineContext}.
 */

import { createAccountResolvePhase } from '../../Phases/AccountResolve/AccountResolvePhase.js';
import { createAuthDiscoveryPhase } from '../../Phases/AuthDiscovery/AuthDiscoveryPhase.js';
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

/** Factory + predicate pair for a single phase slot in the chain. */
interface IPhaseSlot {
  readonly factory: (state: IBuilderState) => BasePhase;
  readonly enabled: (state: IBuilderState) => boolean;
}

// ── Predicates ───────────────────────────────────────────────────

/**
 * Predicate: every browser-only phase (INIT/HOME/AUTH-DISCOVERY/
 * ACCOUNT-RESOLVE/DASHBOARD/TERMINATE).
 *
 * @param state - Builder state.
 * @returns True for browser-mode pipelines.
 */
function ifBrowser(state: IBuilderState): boolean {
  return state.hasBrowser;
}

/**
 * Predicate: HOME — browser path AND no opt-out via `withSkipHome()`.
 * Hapoalim sets `skipHome` because its bank URL is the login page
 * directly (no marketing homepage to discover the login link on).
 *
 * @param state - Builder state.
 * @returns True when HOME should run.
 */
function ifBrowserAndNotSkipHome(state: IBuilderState): boolean {
  return state.hasBrowser && !state.skipHome;
}

/**
 * Predicate: PRE-LOGIN — opt-in flag plus browser path.
 *
 * @param state - Builder state.
 * @returns True when the user opted into PRE-LOGIN AND is on the
 *   browser path.
 */
function ifBrowserAndPreLogin(state: IBuilderState): boolean {
  return state.hasBrowser && state.hasPreLogin;
}

/**
 * Predicate: LOGIN — always present. {@link buildLoginPhase}
 * selects declarative vs API-direct internally.
 *
 * @returns Always true.
 */
function ifLoginAlways(): boolean {
  return true;
}

/**
 * Predicate: OTP-TRIGGER — both OTP-FILL and OTP-TRIGGER opt-ins
 * must be set.
 *
 * @param state - Builder state.
 * @returns True when both OTP flags are set.
 */
function ifOtpFillAndTrigger(state: IBuilderState): boolean {
  return state.hasOtpFill && state.hasOtpTrigger;
}

/**
 * Predicate: OTP-FILL — opt-in flag.
 *
 * @param state - Builder state.
 * @returns True when OTP-FILL is enabled.
 */
function ifOtpFill(state: IBuilderState): boolean {
  return state.hasOtpFill;
}

/**
 * Predicate: SCRAPE — any configured scraper (browser-mode OR
 * declarative scrapeFn).
 *
 * @param state - Builder state.
 * @returns True when any scraper is configured.
 */
function ifAnyScraper(state: IBuilderState): boolean {
  return state.hasBrowser || Boolean(state.scrapeFn);
}

// ── Factories ────────────────────────────────────────────────────

/**
 * Build the INIT phase instance.
 *
 * @returns INIT phase.
 */
function makeInit(): BasePhase {
  return createInitPhase();
}

/**
 * Build the HOME phase instance.
 *
 * @returns HOME phase.
 */
function makeHome(): BasePhase {
  return createHomePhase();
}

/**
 * Build the PRE-LOGIN phase instance.
 *
 * @returns PRE-LOGIN phase.
 */
function makePreLogin(): BasePhase {
  return createPreLoginPhase();
}

/**
 * Build the LOGIN phase instance — variant selected by builder
 * state (declarative vs API-direct).
 *
 * @param state - Builder state.
 * @returns LOGIN phase.
 */
function makeLogin(state: IBuilderState): BasePhase {
  return buildLoginPhase(state);
}

/**
 * Build the OTP-TRIGGER phase instance.
 *
 * @returns OTP-TRIGGER phase.
 */
function makeOtpTrigger(): BasePhase {
  return createOtpTriggerPhase();
}

/**
 * Build the OTP-FILL phase instance with the required-flag from
 * builder state.
 *
 * @param state - Builder state.
 * @returns OTP-FILL phase.
 */
function makeOtpFill(state: IBuilderState): BasePhase {
  return createOtpFillPhase(state.otpFillRequired);
}

/**
 * Build the AUTH-DISCOVERY phase instance — Mission 1.
 *
 * @returns AUTH-DISCOVERY phase.
 */
function makeAuthDiscovery(): BasePhase {
  return createAuthDiscoveryPhase();
}

/**
 * Build the ACCOUNT-RESOLVE phase instance.
 *
 * @returns ACCOUNT-RESOLVE phase.
 */
function makeAccountResolve(): BasePhase {
  return createAccountResolvePhase();
}

/**
 * Build the DASHBOARD phase instance.
 *
 * @returns DASHBOARD phase.
 */
function makeDashboard(): BasePhase {
  return createDashboardPhase();
}

/**
 * Build the SCRAPE phase instance with the executor resolved from
 * builder state.
 *
 * @param state - Builder state.
 * @returns SCRAPE phase.
 */
function makeScrape(state: IBuilderState): BasePhase {
  const scrapeExec = resolveScrapeExec(state);
  return createScrapePhase(scrapeExec);
}

/**
 * Build the TERMINATE phase instance.
 *
 * @returns TERMINATE phase.
 */
function makeTerminate(): BasePhase {
  return createTerminatePhase();
}

// ── Phase chain ──────────────────────────────────────────────────

/**
 * The 11-slot phase chain — single, linear, declarative source of
 * truth. Order matters: PRE-LOGIN before LOGIN, OTP-TRIGGER before
 * OTP-FILL, AUTH-DISCOVERY between OTP-FILL (when present) and
 * ACCOUNT-RESOLVE.
 */
const PHASE_CHAIN: readonly IPhaseSlot[] = [
  { factory: makeInit, enabled: ifBrowser },
  { factory: makeHome, enabled: ifBrowserAndNotSkipHome },
  { factory: makePreLogin, enabled: ifBrowserAndPreLogin },
  { factory: makeLogin, enabled: ifLoginAlways },
  { factory: makeOtpTrigger, enabled: ifOtpFillAndTrigger },
  { factory: makeOtpFill, enabled: ifOtpFill },
  { factory: makeAuthDiscovery, enabled: ifBrowser },
  { factory: makeAccountResolve, enabled: ifBrowser },
  { factory: makeDashboard, enabled: ifBrowser },
  { factory: makeScrape, enabled: ifAnyScraper },
  { factory: makeTerminate, enabled: ifBrowser },
];

/**
 * Assemble the ordered phase list from the validated builder state.
 * Pure composition: filter the declarative chain by predicate, map
 * each enabled slot through its factory.
 *
 * @param state - Builder state.
 * @returns Ordered phase array.
 */
function assemblePhases(state: IBuilderState): BasePhase[] {
  const enabled = PHASE_CHAIN.filter((slot): boolean => slot.enabled(state));
  return enabled.map((slot): BasePhase => slot.factory(state));
}

export type { IBuilderState, LoginFn, StepExecFn } from './StepResolvers.js';
export { assemblePhases };
