/**
 * Direct POST login phase — browser + API POST login (Amex/Isracard).
 * Stub: returns succeed(input) until Step 7.
 */

import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/**
 * Stub: direct POST login via browser fetch.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeDirectPostLogin(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Direct POST login step — navigates + POSTs via fetchStrategy. */
const DIRECT_POST_LOGIN_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'direct-post-login',
  execute: executeDirectPostLogin,
};

export default DIRECT_POST_LOGIN_STEP;
export { DIRECT_POST_LOGIN_STEP };
