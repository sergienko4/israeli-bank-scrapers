/**
 * Declarative login phase — wraps LoginChainBuilder for form-based login.
 * Stub: returns succeed(input) until Step 4.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Stub: declarative form-based login.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeDeclarativeLogin(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Declarative login step — fills form fields via SelectorResolver. */
const DECLARATIVE_LOGIN_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'declarative-login',
  execute: executeDeclarativeLogin,
};

export default DECLARATIVE_LOGIN_STEP;
export { DECLARATIVE_LOGIN_STEP };
