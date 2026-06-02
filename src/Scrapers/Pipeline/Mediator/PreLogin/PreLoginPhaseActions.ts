/**
 * PRE-LOGIN phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 * Uses ONLY WK_PRELOGIN via PreLoginActions + PreLoginRevealProbe.
 *
 * PRE:    locate reveal target → resolve contextId + selector
 * ACTION: click reveal (sealed — executor.clickElement from discovery)
 * POST:   validate form visible (password + submit) — hard wait
 * FINAL:  prove form loaded → signal loginAreaReady to LOGIN
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
  IPreLoginDiscovery,
  IResolvedTarget,
  RevealStatus,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IActionMediator, IElementMediator } from '../Elements/ElementMediator.js';
import {
  isFormAlreadyVisible,
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  validateFormGatePost,
} from './PreLoginActions.js';
import { probeRevealStatus } from './PreLoginRevealProbe.js';

/** Timeout for reveal discovery. */
const DISCOVER_TIMEOUT = 15_000;
/** Timeout for private-customers reveal navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;
/** Timeout for resolve to get reveal target. */
const RESOLVE_TARGET_TIMEOUT = 5000;

/**
 * Resolve the reveal button to a sealed target (contextId + selector).
 * Uses mediator.resolveVisible on WK_PRELOGIN.REVEAL.
 * @param mediator - Full mediator with resolveVisible.
 * @param page - Browser page for contextId computation.
 * @returns IResolvedTarget or false if not found.
 */
async function resolveRevealTarget(
  mediator: IElementMediator,
  page: Page,
): Promise<IResolvedTarget | false> {
  const candidates = WK_PRELOGIN.REVEAL as unknown as readonly SelectorCandidate[];
  const result = await mediator
    .resolveVisible(candidates, RESOLVE_TARGET_TIMEOUT)
    .catch((): false => false);
  if (!result) return false;
  if (!result.found) return false;
  return raceResultToTarget(result, page);
}

/**
 * Resolve reveal target from browser context.
 * @param mediator - Full mediator.
 * @param input - Pipeline context with browser.
 * @returns Resolved target or false.
 */
async function resolveRevealFromBrowser(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<IResolvedTarget | false> {
  if (!input.browser.has) return false;
  return resolveRevealTarget(mediator, input.browser.value.page);
}

/**
 * Resolve a reveal target only when at least one probe matched.
 * Avoids the resolve call when probes returned NOT_FOUND.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @param hasReveal - Whether either probe returned non-NOT_FOUND.
 * @returns IResolvedTarget or false.
 */
async function resolveTargetWhenSeen(
  mediator: IElementMediator,
  input: IPipelineContext,
  hasReveal: boolean,
): Promise<IResolvedTarget | false> {
  if (!hasReveal) return false;
  return resolveRevealFromBrowser(mediator, input);
}

/**
 * Build the PRE-LOGIN discovery payload.
 * @param privateCustomers - First probe result.
 * @param credentialArea - Second probe result.
 * @param revealTarget - Resolved click target or false.
 * @returns IPreLoginDiscovery — CLICK if target resolved, else NONE.
 */
function buildPreLoginDiscovery(
  privateCustomers: RevealStatus,
  credentialArea: RevealStatus,
  revealTarget: IResolvedTarget | false,
): IPreLoginDiscovery {
  if (revealTarget) {
    return { privateCustomers, credentialArea, revealAction: 'CLICK', revealTarget };
  }
  return { privateCustomers, credentialArea, revealAction: 'NONE' };
}

/**
 * Race both REVEAL probes (privateCustomers + credentialArea) at the
 * configured discovery timeout. Pure observer — emits no log events.
 *
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger threaded into the probe for masked
 *   visible-text events.
 * @returns Tuple of [privateCustomers, credentialArea] reveal statuses.
 */
async function runRevealProbes(
  mediator: IElementMediator,
  logger: IPipelineContext['logger'],
): Promise<readonly [RevealStatus, RevealStatus]> {
  const privateCustomers = await probeRevealStatus(mediator, DISCOVER_TIMEOUT, logger);
  const credentialArea = await probeRevealStatus(mediator, DISCOVER_TIMEOUT, logger);
  return [privateCustomers, credentialArea];
}

/**
 * Emit the PRE-LOGIN "reveal target" diagnostic line. Builds the
 * post-arrow location suffix when a target resolved; emits the bare
 * boolean otherwise. Side-effect only.
 *
 * @param logger - Pipeline logger.
 * @param revealTarget - Resolved click target, or false when none.
 * @returns True after the event is emitted.
 */
function logRevealTarget(
  logger: IPipelineContext['logger'],
  revealTarget: IResolvedTarget | false,
): true {
  const hasFoundTarget = Boolean(revealTarget);
  const targetInfo = revealTarget && ` → ${revealTarget.contextId} > ${revealTarget.selector}`;
  logger.debug({ message: `reveal target: ${String(hasFoundTarget)}${targetInfo || ''}` });
  return true;
}

/**
 * Emit the PRE-LOGIN entry telemetry: masked URL trace + the
 * "probing reveal" debug line. Side-effect only — single helper so
 * {@link executePreLocateReveal} stays inside the per-fn ceiling.
 *
 * @param mediator - Element mediator (current URL probe).
 * @param logger - Pipeline logger.
 * @returns True after both events have been emitted.
 */
function logPreLocateEntry(mediator: IElementMediator, logger: IPipelineContext['logger']): true {
  const rawUrl = mediator.getCurrentUrl();
  logger.trace({ message: maskVisibleText(rawUrl) });
  logger.debug({ message: 'probing reveal' });
  return true;
}

/**
 * PRE: Probe REVEAL first; resolve target if any probe matched.
 * Reveal-first (no form-visible short-circuit) is required for 2-form
 * modal banks (Amex/Isracard flip cards) where the back-panel password
 * input is treated by Playwright as "visible" via CSS 3D transforms —
 * the previous form-visible check fired falsely and skipped the flip
 * click. The fix keeps the change generic (uses WK_PRELOGIN.REVEAL,
 * zero per-bank code) and surgically only affects the buggy case;
 * Max + VisaCal already used the probe path at baseline (hasPwd:false)
 * so behaviour is unchanged for them.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Updated context with preLoginDiscovery.
 */
async function executePreLocateReveal(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const logger = input.logger;
  logPreLocateEntry(mediator, logger);
  const [privateCustomers, credentialArea] = await runRevealProbes(mediator, logger);
  const hasReveal = privateCustomers !== 'NOT_FOUND' || credentialArea !== 'NOT_FOUND';
  const revealTarget = await resolveTargetWhenSeen(mediator, input, hasReveal);
  logRevealTarget(logger, revealTarget);
  const disc = buildPreLoginDiscovery(privateCustomers, credentialArea, revealTarget);
  return succeed({ ...input, preLoginDiscovery: some(disc) });
}

/**
 * Execute a sealed click on a resolved reveal target. Caller MUST have
 * already narrowed `input.executor.has` and pass the narrowed value.
 *
 * @param input - Sealed action context.
 * @param target - Pre-resolved target with contextId + selector.
 * @param executor - Pre-narrowed executor from caller's `.has` gate.
 * @returns Succeed with input after click + network settle.
 */
async function executeSealedClick(
  input: IActionContext,
  target: IResolvedTarget,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  input.logger.debug({
    message: `sealed-reveal: CLICK → ${target.contextId} > ${target.selector}`,
  });
  await executor.clickElement({ contextId: target.contextId, selector: target.selector });
  await executor.waitForNetworkIdle(5000).catch((): false => false);
  return succeed(input);
}

/**
 * Execute a sealed NAVIGATE reveal: navigate to the resolved URL via
 * the executor. The selector field carries the URL in the NAVIGATE
 * shape (see {@link IPreLoginDiscovery.revealTarget}). Side-effect
 * only — caller still returns the original action context verbatim.
 *
 * @param input - Sealed action context.
 * @param target - Resolved navigation target (selector = URL).
 * @param executor - Pre-narrowed executor from caller's `.has` gate.
 * @returns Succeed wrapping the input context after navigation.
 */
async function executeSealedNavigate(
  input: IActionContext,
  target: IResolvedTarget,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  const url = target.selector;
  input.logger.debug({ message: `sealed-reveal: NAVIGATE → ${maskVisibleText(url)}` });
  await executor.navigateTo(url);
  return succeed(input);
}

/**
 * Dispatch a sealed reveal action against the resolved target. CLICK
 * delegates to {@link executeSealedClick}; NAVIGATE delegates to
 * {@link executeSealedNavigate}; anything else falls through to the
 * "no target/executor" diagnostic.
 *
 * @param input - Sealed action context.
 * @param disc - Frozen PRE-LOGIN discovery payload.
 * @returns Succeed Procedure after dispatch, or `false` when the
 *   action is neither CLICK nor NAVIGATE (caller logs + passes through).
 */
async function dispatchSealedReveal(
  input: IActionContext,
  disc: IPreLoginDiscovery,
): Promise<Procedure<IActionContext> | false> {
  if (!disc.revealTarget || !input.executor.has) return false;
  const executor = input.executor.value;
  const target = disc.revealTarget;
  if (disc.revealAction === 'CLICK') return executeSealedClick(input, target, executor);
  if (disc.revealAction === 'NAVIGATE') return executeSealedNavigate(input, target, executor);
  return false;
}

/** Static log payload for early-exit sealed-reveal branches. */
const SEALED_REVEAL_EXIT_MSG: Record<string, string> = {
  'no-discovery': 'sealed-reveal: no discovery',
  NONE: 'sealed-reveal: NONE (form already visible)',
};

/**
 * Emit the early-exit log for a sealed-reveal branch and pass the
 * action context through unchanged. Keeps the orchestrator's branches
 * symmetric (each is a single statement) so it stays ≤ 10 LoC.
 *
 * @param input - Sealed action context.
 * @param key - Lookup key into {@link SEALED_REVEAL_EXIT_MSG}.
 * @returns Pass-through success Procedure.
 */
function logExitAndPass(input: IActionContext, key: string): Procedure<IActionContext> {
  input.logger.debug({ message: SEALED_REVEAL_EXIT_MSG[key] });
  return succeed(input);
}

/**
 * Dispatch a CLICK/NAVIGATE sealed reveal, falling through to a
 * diagnostic "no target/executor" log when neither dispatch fires.
 *
 * @param input - Sealed action context.
 * @param disc - Frozen PRE-LOGIN discovery payload.
 * @returns Success Procedure after dispatch (or pass-through with log).
 */
async function executeDispatchedReveal(
  input: IActionContext,
  disc: IPreLoginDiscovery,
): Promise<Procedure<IActionContext>> {
  const dispatched = await dispatchSealedReveal(input, disc);
  if (dispatched !== false) return dispatched;
  input.logger.debug({ message: `sealed-reveal: ${disc.revealAction} but no target/executor` });
  return succeed(input);
}

/**
 * ACTION (sealed): Fire reveal click using only IActionContext fields.
 * Reads revealAction + revealTarget from preLoginDiscovery.
 * CLICK: executor.clickElement(contextId, selector).
 * NAVIGATE: executor.navigateTo(url).
 * NONE: pass through.
 * @param input - Sealed action context.
 * @returns Succeed after click, or pass-through.
 */
async function executeFireRevealClicksSealed(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (!input.preLoginDiscovery.has) return logExitAndPass(input, 'no-discovery');
  const disc = input.preLoginDiscovery.value;
  if (disc.revealAction === 'NONE') return logExitAndPass(input, 'NONE');
  return executeDispatchedReveal(input, disc);
}

/** Bundled args for `executeFireRevealClicks` reveal-click probes. */
interface IFireRevealArgs {
  readonly mediator: IElementMediator;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
  readonly disc: IPreLoginDiscovery | false;
}

/**
 * Run the `privateCustomers` reveal-click branch when the discovery
 * payload says it matched. Side-effect only.
 *
 * @param args - Bundled mediator + page + logger + discovery payload.
 * @returns True when the click attempt fired, false when it was skipped.
 */
async function runPrivateCustomersBranch(args: IFireRevealArgs): Promise<boolean> {
  const { mediator, page, logger, disc } = args;
  if (!disc || disc.privateCustomers === 'NOT_FOUND') return false;
  const clickArgs = { mediator, browserPage: page, navTimeout: REVEAL_NAV_TIMEOUT, logger };
  await tryClickPrivateCustomers(clickArgs);
  return true;
}

/**
 * Run the two reveal-click attempts (`privateCustomers` then
 * `credentialArea`) whenever the discovery payload says they matched.
 * Pure side-effect — original Procedure shape is not threaded back.
 *
 * @param args - Bundled mediator + page + logger + discovery payload.
 * @returns True after both branches have either run or skipped.
 */
async function runRevealClicks(args: IFireRevealArgs): Promise<true> {
  const { mediator, logger, disc } = args;
  await runPrivateCustomersBranch(args);
  if (disc && disc.credentialArea !== 'NOT_FOUND') await tryClickCredentialArea(mediator, logger);
  return true;
}

/**
 * ACTION: Fire reveal clicks (legacy — full context).
 * @param mediator - Element mediator.
 * @param page - Browser page.
 * @param input - Pipeline context with discovery.
 * @returns Succeed with input.
 */
async function executeFireRevealClicks(
  mediator: IElementMediator,
  page: Page,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const logger = input.logger;
  const disc = input.preLoginDiscovery.has && input.preLoginDiscovery.value;
  await runRevealClicks({ mediator, page, logger, disc });
  const hasPwd = await isFormAlreadyVisible(mediator, logger);
  const iframeCount = page.frames().length - 1;
  logger.debug({ hasPwd, iframes: iframeCount });
  return succeed(input);
}

/**
 * Log the FORM_GATE-validated URL once POST has confirmed the form
 * is interactable. Side-effect only — caller composes the success
 * Procedure with `loginAreaReady` set.
 *
 * @param mediator - Element mediator (for current URL).
 * @param logger - Pipeline logger.
 * @returns True after the masked URL is emitted.
 */
function logValidatedFormUrl(mediator: IElementMediator, logger: IPipelineContext['logger']): true {
  const validatedUrl = mediator.getCurrentUrl();
  const maskedUrl = maskVisibleText(validatedUrl);
  logger.debug({ text: maskedUrl });
  return true;
}

/**
 * POST: Validate login form is visible (password field found).
 * Hard wait — 15s timeout for slow SPAs.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Succeed with loginAreaReady=true, or fail.
 */
async function executeValidateForm(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const isReady = await validateFormGatePost(mediator);
  if (!isReady) {
    input.logger.debug({ hasPwd: false, iframes: 0 });
    return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN: no password field');
  }
  logValidatedFormUrl(mediator, input.logger);
  return succeed({ ...input, loginAreaReady: true });
}

/**
 * FINAL: Prove login form is loaded → signal to LOGIN.
 * Guard clause: loginAreaReady must be set by POST.
 * @param input - Pipeline context.
 * @returns Succeed if ready, fail if not.
 */
function executeSignalToLogin(input: IPipelineContext): Procedure<IPipelineContext> {
  if (!input.loginAreaReady) {
    return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN FINAL: login form not ready');
  }
  input.logger.debug({
    message: 'login form READY → signal to LOGIN',
  });
  return succeed(input);
}

export {
  executeFireRevealClicks,
  executeFireRevealClicksSealed,
  executePreLocateReveal,
  executeSignalToLogin,
  executeValidateForm,
};
