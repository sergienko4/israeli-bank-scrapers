/**
 * HOME phase Mediator actions — navigate, validate, signal.
 * Phase orchestrates ONLY. All logic here.
 * Uses ONLY WK_HOME. Never imports from PreLoginWK or LoginWK.
 *
 * Rule #20: PRE is passive (HomeResolver.ts). ACTION is the Executioner.
 *
 * SRP rule (Phase 6): ACTION clicks ONLY the PRE-resolved
 * `triggerTarget` (identity selector). No `text=<value>` re-resolution,
 * no tier-cascade onto a different DOM element, no href-scan rescue.
 * If the click doesn't navigate, ACTION returns false and the phase
 * fails loud.
 */

import type { Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../Elements/ElementMediator.js';
import {
  HOME_ENTRY_TIMEOUT_MS,
  HOME_FORM_READY_TIMEOUT_MS,
  HOME_MODAL_SETTLE_TIMEOUT_MS,
  HOME_SETTLE_TIMEOUT_MS,
  HOME_SPA_NAV_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';
import type { IHomeDiscovery } from './HomeResolver.js';
import { NAV_STRATEGY } from './HomeResolver.js';

/** Bundled args for login area validation. */
interface IValidateLoginAreaArgs {
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly homepageUrl: string;
  readonly logger: ScraperLogger;
}

/**
 * POST: Validate URL changed from homepage OR login iframe appeared.
 * @param args - Bundled validation arguments.
 * @returns Succeed if login area detected, fail otherwise.
 */
async function executeValidateLoginArea(
  args: IValidateLoginAreaArgs,
): Promise<Procedure<IPipelineContext>> {
  const { mediator, input, homepageUrl, logger } = args;
  const currentUrl = mediator.getCurrentUrl();
  const didNavigate = currentUrl !== homepageUrl;
  let frameCount = 0;
  if (input.browser.has) frameCount = input.browser.value.page.frames().length;
  const hasFrames = frameCount > 1;
  const formGate = WK_HOME.FORM_CHECK as unknown as readonly SelectorCandidate[];
  const formProbe = await mediator
    .resolveVisible(formGate, HOME_ENTRY_TIMEOUT_MS)
    .catch((): false => false);
  const hasLoginForm: boolean = formProbe !== false && formProbe.found;
  logger.debug({
    didNavigate,
    frames: frameCount,
    loginForm: hasLoginForm,
  });
  if (didNavigate || hasFrames || hasLoginForm) return succeed(input);
  return fail(ScraperErrorTypes.Generic, 'HOME POST: login area not detected');
}

/**
 * FINAL: Prove form ready + store loginUrl → signal to PRE-LOGIN.
 * Scans all frames for password field (FORM_GATE) before signaling.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @param logger - Pipeline logger.
 * @returns Updated context with loginUrl in diagnostics.
 */
async function executeStoreLoginSignal(
  mediator: IElementMediator,
  input: IPipelineContext,
  logger: ScraperLogger,
): Promise<Procedure<IPipelineContext>> {
  const loginUrl = mediator.getCurrentUrl();
  await waitForFormReady(mediator, logger);
  const diag = { ...input.diagnostics, loginUrl };
  logger.debug({
    url: maskVisibleText(loginUrl),
    didNavigate: true,
  });
  return succeed({ ...input, diagnostics: diag });
}

/**
 * Wait for login form to be ready in any frame (password field visible).
 * Generic: searches all contexts via mediator.resolveVisible.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns True if form ready, false on timeout.
 */
async function waitForFormReady(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<boolean> {
  const gate = WK_PRELOGIN.FORM_GATE as unknown as readonly SelectorCandidate[];
  const result = await mediator
    .resolveVisible(gate, HOME_FORM_READY_TIMEOUT_MS)
    .catch((): false => false);
  const isReady = result !== false && result.found;
  logger.debug({ message: `form-ready: ${String(isReady)}` });
  return isReady;
}

// ── Legacy compat — old tests import these names ──

/**
 * Legacy: click login link via WK_HOME.ENTRY.
 * @param mediator - Element mediator.
 * @returns Procedure with IRaceResult.
 */
async function tryClickLoginLink(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  return mediator.resolveAndClick(WK_HOME.ENTRY);
}

/**
 * Legacy: wait for any WK login link to become visible.
 * @param browserPage - Browser page.
 * @returns True if any login link visible.
 */
async function waitForAnyLoginLink(browserPage: Page): Promise<boolean> {
  const candidates = WK_HOME.ENTRY;
  const locators = candidates.map((c): Locator => browserPage.getByText(c.value).first());
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout: HOME_ENTRY_TIMEOUT_MS });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results.some((r): boolean => r.status === 'fulfilled');
}

/** Timeout for modal iframe content to render. */

/**
 * Execute MODAL click — click trigger, wait for iframe content.
 * All HTML interaction via sealed executor (Mediator pattern). Returns
 * `true` once the trigger click and settle complete, `false` only when
 * no triggerTarget was resolved. URL never changes for modal flows so
 * callers must NOT use this value as a "did navigate" signal — POST
 * validates the iframe.
 * @param executor - Sealed action mediator.
 * @param discovery - Home discovery with MODAL strategy.
 * @param logger - Pipeline logger.
 * @returns True when the trigger click was attempted and settled.
 */
async function executeModalClick(
  executor: IActionMediator,
  discovery: IHomeDiscovery,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!discovery.triggerTarget) return false;
  const { contextId, selector } = discovery.triggerTarget;
  await executor.clickElement({ contextId, selector }).catch((): false => false);
  logger.debug({ message: 'modal: trigger clicked, waiting for content' });
  await executor.waitForNetworkIdle(HOME_MODAL_SETTLE_TIMEOUT_MS).catch((): false => false);
  return true;
}

/**
 * Click a pre-resolved target via executor.
 *
 * Mirrors the MODAL pattern at executeModalClick: a click that throws
 * (Playwright auto-wait timeout when navigation hangs under CDN load)
 * is absorbed and surfaced as a `false` return so settleAfterClick +
 * POST validation can decide success via URL change. Without the
 * catch, a hung click rejects unhandled and crashes HOME.ACTION before
 * any logging — the rotating-bank flakiness signature.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved target from PRE.
 * @param isForce - Force click for hidden toggles.
 * @returns True if click resolved cleanly, false if executor rejected.
 */
async function clickResolvedTarget(
  executor: IActionMediator,
  target: IResolvedTarget,
  isForce?: boolean,
): Promise<boolean> {
  return executor
    .clickElement({ contextId: target.contextId, selector: target.selector, isForce })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Wait for SPA route + network settle after click.
 * @param executor - Sealed action mediator.
 * @param isSequential - Whether to settle before URL wait.
 * @returns True when settled.
 */
async function settleAfterClick(
  executor: IActionMediator,
  isSequential: boolean,
): Promise<boolean> {
  if (isSequential) {
    await executor.waitForNetworkIdle(HOME_SETTLE_TIMEOUT_MS).catch((): false => false);
  }
  await executor.waitForURL('**/login**', HOME_SPA_NAV_TIMEOUT_MS).catch((): false => false);
  await executor.waitForNetworkIdle(HOME_SETTLE_TIMEOUT_MS).catch((): false => false);
  return true;
}

/**
 * Execute HOME navigation via sealed executor — SRP: ACTION clicks
 * ONLY the PRE-resolved `triggerTarget` (identity selector captured
 * by the resolver). Strategy dispatch:
 *   • MODAL: open the modal overlay (separate flow).
 *   • DIRECT / SEQUENTIAL: single click on `triggerTarget`, then
 *     wait for the URL to change. No tier fallback, no `text=`
 *     re-resolution, no href-scan rescue. If the URL doesn't change
 *     within `HOME_SETTLE_TIMEOUT_MS`, return false — caller fails loud.
 *
 * Why both strategies use the same single-click path: live cross-
 * validation (2026-05-06) showed every non-OTP bank's HOME click
 * resolves to ONE element. The legacy SEQUENTIAL "second click via
 * text=<value>" fired against an unscoped locator that could match
 * a DIFFERENT DOM element with the same visible text — the Max BoG
 * regression. Removing it eliminates that whole class of bug.
 * @param executor - Sealed action mediator.
 * @param discovery - Discovery from PRE.
 * @param logger - Pipeline logger.
 * @returns True iff `page.url()` changed after the click.
 */
async function executeHomeNavigation(
  executor: IActionMediator,
  discovery: IHomeDiscovery,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!discovery.triggerTarget) return false;
  if (discovery.strategy === NAV_STRATEGY.MODAL) {
    return executeModalClick(executor, discovery, logger);
  }
  const urlBefore = executor.getCurrentUrl();
  const isSeq = discovery.strategy === NAV_STRATEGY.SEQUENTIAL;
  await clickResolvedTarget(executor, discovery.triggerTarget, isSeq);
  await settleAfterClick(executor, isSeq);
  const currentUrl = executor.getCurrentUrl();
  const didNavigate = urlBefore !== currentUrl;
  logger.debug({ url: maskVisibleText(currentUrl), didNavigate });
  return didNavigate;
}

export {
  executeHomeNavigation,
  executeModalClick,
  executeStoreLoginSignal,
  executeValidateLoginArea,
  tryClickLoginLink,
  waitForAnyLoginLink,
};
