/**
 * PRE-LOGIN phase actions — reveal clicks + form readiness wait.
 * Uses ONLY WK_PRELOGIN. Never imports from HomeWK or LoginWK.
 * After each reveal click, waits for FORM_GATE (input[type="password"]).
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
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
  return result && result.found;
}

/**
 * Quick probe: is the login form already visible?
 * Used by PRE to skip reveal when form is already rendered.
 * @param mediator - Element mediator (black box).
 * @returns True if password field found.
 */
async function isFormAlreadyVisible(mediator: IElementMediator): Promise<boolean> {
  const result = await mediator
    .resolveVisible(FORM_GATE, FORM_PROBE_TIMEOUT)
    .catch((): false => false);
  if (!result) return false;
  return result.found;
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

/**
 * Click a WK_PRELOGIN.REVEAL element, then wait for password field.
 * @param mediator - Element mediator.
 * @param browserPage - Browser page.
 * @param navTimeout - Navigation wait timeout.
 * @returns Procedure with IRaceResult.
 */
async function tryClickPrivateCustomers(
  mediator: IElementMediator,
  browserPage: Page,
  navTimeout: number,
): Promise<Procedure<IRaceResult>> {
  const clickResult = await mediator.resolveAndClick(WK_PRELOGIN.REVEAL);
  if (!clickResult.success) {
    process.stderr.write('      [PRE-LOGIN] reveal click: FAIL\n');
    return clickResult;
  }
  if (!clickResult.value.found) {
    process.stderr.write('      [PRE-LOGIN] reveal click: NOT FOUND\n');
    return clickResult;
  }
  const label = clickResult.value.value;
  process.stderr.write(`      [PRE-LOGIN] reveal CLICKED: "${label}"\n`);
  const navOpts = { timeout: navTimeout, waitUntil: 'domcontentloaded' as const };
  await browserPage.waitForURL('**/login**', navOpts).catch((): false => false);
  const hasForm = await waitForFormGate(mediator);
  process.stderr.write(`      [PRE-LOGIN] after reveal: formGate=${String(hasForm)}\n`);
  return clickResult;
}

/**
 * Click the login method tab, then wait for password field.
 * @param mediator - Element mediator.
 * @returns Procedure with IRaceResult.
 */
async function tryClickCredentialArea(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  const result = await mediator.resolveAndClick(WK_PRELOGIN.REVEAL, CRED_AREA_TIMEOUT);
  if (result.success && result.value.found) {
    const label = result.value.value;
    process.stderr.write(`      [PRE-LOGIN] credentialArea CLICKED: "${label}"\n`);
    const hasForm = await waitForFormGate(mediator);
    process.stderr.write(`      [PRE-LOGIN] after credentialArea: formGate=${String(hasForm)}\n`);
  }
  if (result.success && !result.value.found) {
    process.stderr.write('      [PRE-LOGIN] credentialArea: NOT FOUND\n');
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
