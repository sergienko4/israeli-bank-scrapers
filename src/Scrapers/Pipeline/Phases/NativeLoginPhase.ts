/**
 * Native login phase — no-browser login for API-only scrapers (OneZero).
 * Stub: returns succeed(input) until Step 8.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Stub: native API login without browser.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeNativeLogin(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Native login step — uses native fetch, no browser context. */
const NATIVE_LOGIN_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'native-login',
  execute: executeNativeLogin,
};

export default NATIVE_LOGIN_STEP;
export { NATIVE_LOGIN_STEP };
