/**
 * OTP form probe — WK_LOGIN_FORM.mfa selector resolution via mediator.
 * Phases call this function instead of importing WK directly.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Timeout for probing OTP form presence. */
const OTP_PROBE_TIMEOUT = 3000;

/**
 * Detect if an OTP form is present on the page.
 * Uses WellKnown otpCode candidates — if any is visible, OTP is required.
 * @param mediator - Active mediator.
 * @returns Procedure with boolean detection result.
 */
export default async function detectOtpForm(
  mediator: IElementMediator,
): Promise<Procedure<boolean>> {
  const candidates = WK_LOGIN_FORM.mfa as unknown as readonly SelectorCandidate[];
  const result = await mediator.resolveVisible(candidates, OTP_PROBE_TIMEOUT);
  return succeed(result.found);
}
