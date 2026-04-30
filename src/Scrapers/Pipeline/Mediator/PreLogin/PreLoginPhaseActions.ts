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
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
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
 * PRE: Locate reveal target. If form already visible → revealAction='NONE'.
 * If reveal found → resolve to IResolvedTarget, revealAction='CLICK'.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Updated context with preLoginDiscovery.
 */
async function executePreLocateReveal(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const logger = input.logger;
  const rawUrl = mediator.getCurrentUrl();
  logger.trace({
    message: maskVisibleText(rawUrl),
  });

  if (await isFormAlreadyVisible(mediator, logger)) {
    logger.debug({ hasPwd: true, iframes: 0 });
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'NOT_FOUND',
      credentialArea: 'NOT_FOUND',
      revealAction: 'NONE',
    };
    return succeed({ ...input, preLoginDiscovery: some(disc) });
  }

  logger.debug({
    message: 'probing reveal',
  });
  const privateCustomers = await probeRevealStatus(mediator, DISCOVER_TIMEOUT, logger);
  const credentialArea = await probeRevealStatus(mediator, DISCOVER_TIMEOUT, logger);

  const hasReveal = privateCustomers !== 'NOT_FOUND' || credentialArea !== 'NOT_FOUND';
  if (!hasReveal) {
    const disc: IPreLoginDiscovery = {
      privateCustomers,
      credentialArea,
      revealAction: 'NONE',
    };
    return succeed({ ...input, preLoginDiscovery: some(disc) });
  }

  const revealTarget = await resolveRevealFromBrowser(mediator, input);
  const hasFoundTarget = Boolean(revealTarget);
  const targetInfo = revealTarget && ` → ${revealTarget.contextId} > ${revealTarget.selector}`;
  logger.debug({
    message: `reveal target: ${String(hasFoundTarget)}${targetInfo || ''}`,
  });

  const actionMap: Record<string, 'CLICK' | 'NONE'> = { true: 'CLICK', false: 'NONE' };
  const hasTarget = Boolean(revealTarget);
  const revealAction = actionMap[String(hasTarget)];
  const disc: IPreLoginDiscovery = {
    privateCustomers,
    credentialArea,
    revealAction,
    revealTarget: revealTarget || undefined,
  };
  return succeed({ ...input, preLoginDiscovery: some(disc) });
}

/**
 * Execute a sealed click on a resolved reveal target.
 * @param input - Sealed action context.
 * @param target - Pre-resolved target with contextId + selector.
 * @returns Succeed with input after click + network settle.
 */
async function executeSealedClick(
  input: IActionContext,
  target: IResolvedTarget,
): Promise<Procedure<IActionContext>> {
  if (!input.executor.has) return succeed(input);
  const executor = input.executor.value;
  input.logger.debug({
    message: `sealed-reveal: CLICK → ${target.contextId} > ${target.selector}`,
  });
  await executor.clickElement({ contextId: target.contextId, selector: target.selector });
  await executor.waitForNetworkIdle(5000).catch((): false => false);
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
  const logger = input.logger;
  if (!input.preLoginDiscovery.has) {
    logger.debug({
      message: 'sealed-reveal: no discovery',
    });
    return succeed(input);
  }
  const disc = input.preLoginDiscovery.value;

  if (disc.revealAction === 'NONE') {
    logger.debug({
      message: 'sealed-reveal: NONE (form already visible)',
    });
    return succeed(input);
  }

  if (disc.revealAction === 'CLICK' && disc.revealTarget && input.executor.has) {
    return executeSealedClick(input, disc.revealTarget);
  }

  if (disc.revealAction === 'NAVIGATE' && disc.revealTarget && input.executor.has) {
    const url = disc.revealTarget.selector;
    logger.debug({
      message: `sealed-reveal: NAVIGATE → ${maskVisibleText(url)}`,
    });
    await input.executor.value.navigateTo(url);
    return succeed(input);
  }

  logger.debug({
    message: `sealed-reveal: ${disc.revealAction} but no target/executor`,
  });
  return succeed(input);
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
  if (disc && disc.privateCustomers !== 'NOT_FOUND') {
    await tryClickPrivateCustomers({
      mediator,
      browserPage: page,
      navTimeout: REVEAL_NAV_TIMEOUT,
      logger,
    });
  }
  if (disc && disc.credentialArea !== 'NOT_FOUND') {
    await tryClickCredentialArea(mediator, logger);
  }
  const hasPwd = await isFormAlreadyVisible(mediator, logger);
  const iframeCount = page.frames().length - 1;
  logger.debug({ hasPwd, iframes: iframeCount });
  return succeed(input);
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
  const validatedUrl = mediator.getCurrentUrl();
  const maskedUrl = maskVisibleText(validatedUrl);
  input.logger.debug({ text: maskedUrl });
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
