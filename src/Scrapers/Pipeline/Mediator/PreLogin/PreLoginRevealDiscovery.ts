/**
 * PRE-LOGIN reveal discovery — probe both REVEAL signals and resolve
 * the click target into a sealed (contextId + selector) shape.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./PreLoginPhaseActions.ts} so each function fits the 10-LoC
 * ceiling and the entry-point file stays under the 150-LoC file cap.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type {
  IPipelineContext,
  IPreLoginDiscovery,
  IResolvedTarget,
  RevealStatus,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { probeRevealStatus } from './PreLoginRevealProbe.js';

/** Timeout for reveal discovery. */
const DISCOVER_TIMEOUT = 15_000;
/** Timeout for resolve to get reveal target. */
const RESOLVE_TARGET_TIMEOUT = 5000;

/**
 * Race the WK_PRELOGIN.REVEAL candidates against the visible-resolver,
 * swallowing rejections so callers can fall through without a try/catch.
 * @param mediator - Element mediator providing the resolver.
 * @returns Race result on a visible hit, or false when none/rejected.
 */
async function probeRevealVisible(mediator: IElementMediator): Promise<IRaceResult | false> {
  const candidates = WK_PRELOGIN.REVEAL as unknown as readonly SelectorCandidate[];
  return mediator.resolveVisible(candidates, RESOLVE_TARGET_TIMEOUT).catch((): false => false);
}

/**
 * Resolve the reveal button to a sealed target (contextId + selector).
 * @param mediator - Full mediator with resolveVisible.
 * @param page - Browser page for contextId computation.
 * @returns IResolvedTarget or false if not found.
 */
async function resolveRevealTarget(
  mediator: IElementMediator,
  page: Page,
): Promise<IResolvedTarget | false> {
  const result = await probeRevealVisible(mediator);
  if (!result || !result.found) return false;
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
 * configured discovery timeout. Pure observer.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger threaded into the probe.
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
 * Emit the PRE-LOGIN "reveal target" diagnostic line.
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
 * "probing reveal" debug line.
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

/** Slim result of {@link probeRevealsAndResolve}. */
interface IPreLocateProbeResult {
  readonly privateCustomers: RevealStatus;
  readonly credentialArea: RevealStatus;
  readonly target: IResolvedTarget | false;
}

/**
 * Run both REVEAL probes and resolve the click target when at least
 * one probe matched. Pure observer.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Slim result with both statuses + resolved target.
 */
async function probeRevealsAndResolve(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<IPreLocateProbeResult> {
  const [privateCustomers, credentialArea] = await runRevealProbes(mediator, input.logger);
  const hasReveal = privateCustomers !== 'NOT_FOUND' || credentialArea !== 'NOT_FOUND';
  const target = await resolveTargetWhenSeen(mediator, input, hasReveal);
  return { privateCustomers, credentialArea, target };
}

/**
 * Build the PRE-LOGIN discovery payload from a probed result and
 * commit it onto `ctx.preLoginDiscovery`.
 * @param input - Pipeline context.
 * @param probed - Slim result of {@link probeRevealsAndResolve}.
 * @returns Success Procedure with the updated context.
 */
function buildAndCommitDiscovery(
  input: IPipelineContext,
  probed: IPreLocateProbeResult,
): Procedure<IPipelineContext> {
  const { privateCustomers, credentialArea, target } = probed;
  const disc = buildPreLoginDiscovery(privateCustomers, credentialArea, target);
  return succeed({ ...input, preLoginDiscovery: some(disc) });
}

/**
 * PRE: Probe REVEAL first; resolve target if any probe matched.
 * Reveal-first (no form-visible short-circuit) is required for 2-form
 * modal banks (Amex/Isracard flip cards) where the back-panel password
 * input is treated by Playwright as "visible" via CSS 3D transforms.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Updated context with preLoginDiscovery.
 */
async function executePreLocateReveal(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  logPreLocateEntry(mediator, input.logger);
  const probed = await probeRevealsAndResolve(mediator, input);
  logRevealTarget(input.logger, probed.target);
  return buildAndCommitDiscovery(input, probed);
}

export default executePreLocateReveal;
export { executePreLocateReveal };
