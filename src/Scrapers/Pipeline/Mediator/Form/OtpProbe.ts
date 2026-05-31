/**
 * OTP probes — trigger screen + code input detection via mediator.
 * Returns full IRaceResult for high-fidelity trace logging.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_LOGIN_ERROR } from '../../Registry/WK/LoginWK.js';
import { WK_OTP_INPUT, WK_OTP_SUBMIT } from '../../Registry/WK/OtpFillWK.js';
import { WK_OTP_TRIGGER } from '../../Registry/WK/OtpTriggerWK.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { NOT_FOUND } from '../Otp/OtpShared.js';
import {
  OTP_ERROR_PROBE_TIMEOUT_MS,
  OTP_FORM_PROBE_TIMEOUT_MS,
  OTP_SUBMIT_PROBE_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';

/**
 * Detect if an OTP code input is present on the page.
 * @param mediator - Active mediator.
 * @returns Procedure with full race result.
 */
async function detectOtpForm(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  const candidates = WK_OTP_INPUT as unknown as readonly SelectorCandidate[];
  const result = await mediator.resolveVisible(candidates, OTP_FORM_PROBE_TIMEOUT_MS);
  return succeed(result);
}

/**
 * Detect if an OTP trigger button is present (send SMS screen).
 * @param mediator - Active mediator.
 * @returns Procedure with full race result.
 */
async function detectOtpTrigger(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  const candidates = WK_OTP_TRIGGER as unknown as readonly SelectorCandidate[];
  const result = await mediator.resolveVisible(candidates, OTP_FORM_PROBE_TIMEOUT_MS);
  return succeed(result);
}

/**
 * Detect OTP submit button — scoped to the same context as the OTP input.
 * When inputContext is provided, searches ONLY that frame (prevents cookie banner false matches).
 * @param mediator - Active mediator.
 * @param inputContext - The frame where OTP input was found (optional — falls back to all frames).
 * @returns Procedure with full race result.
 */
async function detectOtpSubmit(
  mediator: IElementMediator,
  inputContext?: Page | Frame,
): Promise<Procedure<IRaceResult>> {
  const candidates = WK_OTP_SUBMIT as unknown as readonly SelectorCandidate[];
  if (inputContext) {
    return succeed(
      await mediator.resolveVisibleInContext(candidates, inputContext, OTP_SUBMIT_PROBE_TIMEOUT_MS),
    );
  }
  const result = await mediator.resolveVisible(candidates, OTP_SUBMIT_PROBE_TIMEOUT_MS);
  return succeed(result);
}

/**
 * Detect form error text on screen (wrong OTP, invalid code, etc.).
 * @param mediator - Active mediator.
 * @returns Race result (found=true if error visible).
 */
async function detectOtpError(mediator: IElementMediator): Promise<IRaceResult> {
  const candidates = WK_LOGIN_ERROR as unknown as readonly SelectorCandidate[];
  return mediator
    .resolveVisible(candidates, OTP_ERROR_PROBE_TIMEOUT_MS)
    .catch((): IRaceResult => NOT_FOUND);
}

export { detectOtpError, detectOtpForm, detectOtpSubmit, detectOtpTrigger };
