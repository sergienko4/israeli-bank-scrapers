/**
 * A step's session, prepared before its URL, body or headers resolve: its
 * client cookies (N11), then its device certificate (N26).
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import { installStepCert } from './RunStep.clientCert.js';
import { bindStepCookies } from './RunStep.clientCookies.js';
import type { IRunStepArgs } from './RunStep.types.js';

/**
 * Bind the step's client cookies, then install its device certificate.
 * @param args - Run-step args.
 * @returns The args with the step's jar view in scope, or a failure.
 */
function prepareStepSession(args: IRunStepArgs): Procedure<IRunStepArgs> {
  const bound = bindStepCookies(args);
  if (!isOk(bound)) return bound;
  return installStepCert(bound.value);
}

export default prepareStepSession;
export { prepareStepSession };
