/**
 * PRE-LOGIN phase actions — reveal clicks + form readiness wait.
 * Uses ONLY WK_PRELOGIN. Never imports from HomeWK or LoginWK.
 * After each reveal click, waits for FORM_GATE (input[type="password"]).
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/** Timeout for reveal click. */
const REVEAL_NAV_TIMEOUT = 15_000;
/** Timeout for credential-area tab. */
const CRED_AREA_TIMEOUT = 10_000;
/** Timeout for password field to appear after reveal click. */
const FORM_GATE_TIMEOUT = 5000;
/** Quick timeout for PRE probe (form already visible?). */
const FORM_PROBE_TIMEOUT = 3000;
/** Long timeout for POST validation (15s for slow SPAs). */
const FORM_POST_TIMEOUT = 15000;

/** Cast WK_PRELOGIN.FORM_GATE to SelectorCandidate[]. */
const FORM_GATE = WK_PRELOGIN.FORM_GATE as unknown as readonly SelectorCandidate[];

/**
 * Wait for password field to appear after a reveal click.
 * Uses WK_PRELOGIN.FORM_GATE via mediator — zero direct Playwright.
 * @param mediator - Element mediator.
 * @returns True if password field appeared.
 */
async function waitForFormGate(mediator: IElementMediator): Promise<boolean> {
  const result = await mediator
    .resolveVisible(FORM_GATE, FORM_GATE_TIMEOUT)
    .catch((): false => false);
  if (!result) return false;
  return result.found;
}

/**
 * Quick probe: is the login form already visible?
 * Used by PRE to skip reveal when form is already rendered.
 * @param mediator - Element mediator (black box).
 * @returns True if password field found.
 */
/**
 * Guard: is the login form already visible AND interactable?
 * Checks: 1) password input visible 2) submit button visible 3) both truly visible (no ng-hide).
 * @param mediator - Element mediator (black box).
 * @returns True ONLY if both are truly interactable.
 */
/**
 * Guard: is the login form already visible AND interactable?
 * Checks BOTH password input AND submit button are truly visible.
 * If both exist → skip reveal (form is already rendered).
 * If either missing → run reveal flow.
 * @param mediator - Element mediator (black box).
 * @param logger - Pipeline logger.
 * @returns True to skip reveal, false to run reveal.
 */
async function isFormAlreadyVisible(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<boolean> {
  const pwdResult = await mediator
    .resolveVisible(FORM_GATE, FORM_PROBE_TIMEOUT)
    .catch((): false => false);
  if (pwdResult === false) {
    logger.debug({ hasPwd: false, hasSubmit: false });
    return false;
  }
  if (!pwdResult.found) {
    logger.debug({ hasPwd: false, hasSubmit: false });
    return false;
  }
  const submitGate = WK_PRELOGIN.SUBMIT_GATE as unknown as readonly SelectorCandidate[];
  const submitResult = await mediator
    .resolveVisible(submitGate, FORM_PROBE_TIMEOUT)
    .catch((): false => false);
  if (!submitResult) {
    logger.debug({ hasPwd: true, hasSubmit: false });
    return false;
  }
  logger.debug({ hasPwd: true, hasSubmit: submitResult.found });
  return submitResult.found;
}

/**
 * POST validation: verify password field is present after reveal.
 * Longer timeout (15s) for slow SPAs.
 * @param mediator - Element mediator.
 * @returns True if password field found within timeout.
 */
async function validateFormGatePost(mediator: IElementMediator): Promise<boolean> {
  const result = await mediator
    .resolveVisible(FORM_GATE, FORM_POST_TIMEOUT)
    .catch((): false => false);
  if (!result) return false;
  return result.found;
}

/** Timeout in milliseconds for navigation waits. */
type NavTimeoutMs = number;

/** Bundled args for private-customers reveal click. */
interface IRevealClickArgs {
  readonly mediator: IElementMediator;
  readonly browserPage: Page;
  readonly navTimeout: NavTimeoutMs;
  readonly logger: ScraperLogger;
}

/**
 * Click a WK_PRELOGIN.REVEAL element, then wait for password field.
 * @param args - Bundled reveal click arguments.
 * @returns Procedure with IRaceResult.
 */
async function tryClickPrivateCustomers(args: IRevealClickArgs): Promise<Procedure<IRaceResult>> {
  const { mediator, browserPage, navTimeout, logger } = args;
  const clickResult = await mediator.resolveAndClick(WK_PRELOGIN.REVEAL);
  if (!clickResult.success) {
    logger.debug({
      message: 'reveal click: FAIL',
    });
    return clickResult;
  }
  if (!clickResult.value.found) {
    logger.debug({
      message: 'reveal click: NOT FOUND',
    });
    return clickResult;
  }
  const label = clickResult.value.value;
  logger.debug({ text: maskVisibleText(label), formGate: false });
  const navOpts = { timeout: navTimeout, waitUntil: 'domcontentloaded' as const };
  await browserPage.waitForURL('**/login**', navOpts).catch((): false => false);
  const hasForm = await waitForFormGate(mediator);
  logger.debug({ text: maskVisibleText(label), formGate: hasForm });
  return clickResult;
}

/**
 * Click the login method tab, then wait for password field.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns Procedure with IRaceResult.
 */
async function tryClickCredentialArea(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<Procedure<IRaceResult>> {
  const result = await mediator.resolveAndClick(WK_PRELOGIN.REVEAL, CRED_AREA_TIMEOUT);
  if (result.success && result.value.found) {
    const label = result.value.value;
    logger.debug({ text: maskVisibleText(label), formGate: false });
    const hasForm = await waitForFormGate(mediator);
    logger.debug({ text: maskVisibleText(label), formGate: hasForm });
  }
  if (result.success && !result.value.found) {
    logger.debug({
      message: 'credentialArea: NOT FOUND',
    });
  }
  return result;
}

export {
  CRED_AREA_TIMEOUT,
  isFormAlreadyVisible,
  REVEAL_NAV_TIMEOUT,
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  validateFormGatePost,
};
