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

/** Cast WK_PRELOGIN.SUBMIT_GATE to SelectorCandidate[]. */
const SUBMIT_GATE = WK_PRELOGIN.SUBMIT_GATE as unknown as readonly SelectorCandidate[];

/**
 * Quick visibility probe for a single PRE-LOGIN gate (password or submit).
 * Swallows resolver rejections by returning `false` so the caller can
 * stay inside the depth ceiling without an outer try/catch.
 * @param mediator - Element mediator (black box).
 * @param candidates - WK gate candidate list to race.
 * @returns True when the resolver reported a visible match.
 */
async function probeGateVisible(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<boolean> {
  const result = await mediator
    .resolveVisible(candidates, FORM_PROBE_TIMEOUT)
    .catch((): false => false);
  if (result === false) return false;
  return result.found;
}

/**
 * Log a not-visible form-gate outcome and return false. Extracted so
 * {@link isFormAlreadyVisible} stays inside the 10-LoC ceiling.
 * @param logger - Pipeline logger.
 * @returns Always false.
 */
function logNoPasswordVisible(logger: ScraperLogger): false {
  logger.debug({ hasPwd: false, hasSubmit: false });
  return false;
}

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
  const hasPwd = await probeGateVisible(mediator, FORM_GATE);
  if (!hasPwd) return logNoPasswordVisible(logger);
  const hasSubmit = await probeGateVisible(mediator, SUBMIT_GATE);
  logger.debug({ hasPwd: true, hasSubmit });
  return hasSubmit;
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

/** Bundled args for private-customers reveal click. */
interface IRevealClickArgs {
  readonly mediator: IElementMediator;
  readonly browserPage: Page;
  readonly navTimeout: number;
  readonly logger: ScraperLogger;
}

/**
 * Click a WK_PRELOGIN.REVEAL element, then wait for password field.
 * Logs the outcome of each branch and returns the original click
 * Procedure verbatim so the caller can read both success and the
 * inner `found` flag.
 * @param args - Bundled reveal click arguments.
 * @returns Procedure with IRaceResult.
 */
async function tryClickPrivateCustomers(args: IRevealClickArgs): Promise<Procedure<IRaceResult>> {
  const { mediator, browserPage, navTimeout, logger } = args;
  const clickResult = await mediator.resolveAndClick(WK_PRELOGIN.REVEAL);
  await diagnoseRevealClick({ clickResult, mediator, browserPage, navTimeout, logger });
  return clickResult;
}

/** Bundled args for diagnoseRevealClick — fits the 3-param ceiling. */
interface IDiagnoseArgs {
  readonly clickResult: Procedure<IRaceResult>;
  readonly mediator: IElementMediator;
  readonly browserPage: Page;
  readonly navTimeout: number;
  readonly logger: ScraperLogger;
}

/**
 * Translate a reveal-click `Procedure` into a short status string for
 * pure logging. Single-purpose so {@link diagnoseRevealClick} stays
 * within the per-function ceiling without a try/else cascade.
 *
 * @param clickResult - Procedure returned by the reveal click attempt.
 * @returns `'FAIL'` on procedure failure, `'NOT FOUND'` when no candidate
 *   matched, otherwise the masked visible-text label.
 */
function describeRevealClick(clickResult: Procedure<IRaceResult>): string {
  if (!clickResult.success) return 'FAIL';
  if (!clickResult.value.found) return 'NOT FOUND';
  return maskVisibleText(clickResult.value.value);
}

/**
 * Run the post-click `waitForURL → waitForFormGate` sequence and emit
 * the FORM_GATE diagnostic for a successful reveal click. Side-effect
 * only — extracted so {@link diagnoseRevealClick} keeps the procedure
 * branch + the form-gate branch each within the depth ceiling.
 *
 * @param args - Bundled diagnostic arguments shared with the caller.
 * @param label - Masked label of the clicked candidate (for logging).
 * @returns True after the wait sequence completes.
 */
async function waitAndLogFormGate(args: IDiagnoseArgs, label: string): Promise<boolean> {
  const navOpts = { timeout: args.navTimeout, waitUntil: 'domcontentloaded' as const };
  await args.browserPage.waitForURL('**/login**', navOpts).catch((): false => false);
  const hasForm = await waitForFormGate(args.mediator);
  args.logger.debug({ text: label, formGate: hasForm });
  return true;
}

/** Static log payload for non-hit reveal-click outcomes. */
const REVEAL_CLICK_OUTCOME_MSG: Record<string, string> = {
  FAIL: 'reveal click: FAIL',
  'NOT FOUND': 'reveal click: NOT FOUND',
};

/**
 * Log the reveal-click outcome and run the post-click form-gate wait
 * when the click landed on a real candidate. Pure side-effect — the
 * caller still returns the original click Procedure verbatim.
 * @param args - Bundled diagnostic arguments.
 * @returns True when the post-click wait actually executed, false when
 * the click failed or no candidate was found and only the diagnostic
 * log line was emitted.
 */
async function diagnoseRevealClick(args: IDiagnoseArgs): Promise<boolean> {
  const status = describeRevealClick(args.clickResult);
  const nonHitMsg = REVEAL_CLICK_OUTCOME_MSG[status];
  if (nonHitMsg) {
    args.logger.debug({ message: nonHitMsg });
    return false;
  }
  args.logger.debug({ text: status, formGate: false });
  return waitAndLogFormGate(args, status);
}

/**
 * Side-effect logging branch for a successful `credentialArea` reveal
 * click: emits the masked label, runs the form-gate wait and logs the
 * outcome. Returns the form-gate boolean so callers can chain.
 *
 * @param result - Successful race result from the click.
 * @param mediator - Element mediator for the post-click form-gate wait.
 * @param logger - Pipeline logger.
 * @returns Form-gate readiness flag.
 */
/**
 * Run the post-log form-gate wait for a credentialArea hit and emit
 * the matched-text + form-gate outcome.
 * @param text - Pre-masked label of the matched candidate.
 * @param mediator - Element mediator for the form-gate wait.
 * @param logger - Pipeline logger.
 * @returns Form-gate readiness flag.
 */
async function probeFormAfterCredentialLog(
  text: string,
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<boolean> {
  const hasForm = await waitForFormGate(mediator);
  logger.debug({ text, formGate: hasForm });
  return hasForm;
}

/**
 * Side-effect logging branch for a successful `credentialArea` reveal
 * click: emits the masked label, runs the form-gate wait and logs the
 * outcome. Returns the form-gate boolean so callers can chain.
 *
 * @param result - Successful race result from the click.
 * @param mediator - Element mediator for the post-click form-gate wait.
 * @param logger - Pipeline logger.
 * @returns Form-gate readiness flag.
 */
async function logCredentialAreaHit(
  result: IRaceResult,
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<boolean> {
  const text = maskVisibleText(result.value);
  logger.debug({ text, formGate: false });
  return probeFormAfterCredentialLog(text, mediator, logger);
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
  if (!result.success) return result;
  if (result.value.found) await logCredentialAreaHit(result.value, mediator, logger);
  else logger.debug({ message: 'credentialArea: NOT FOUND' });
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
