/**
 * HOME phase probes — WK_HOME selector resolution via mediator.
 * Owns WK_HOME only. Never imports from PreLoginWK or LoginWK.
 * Each phase is a strict State Machine with its own WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/**
 * Probe for a credential field to confirm the form is present.
 * @param mediator - Active mediator.
 * @returns Procedure with IRaceResult — found=true if form field detected.
 */
export async function waitForCredentialsForm(
  mediator: IElementMediator,
): Promise<Procedure<IRaceResult>> {
  const candidates = WK_HOME.FORM_CHECK as unknown as readonly SelectorCandidate[];
  return mediator.resolveAndClick(candidates);
}

export default waitForCredentialsForm;
