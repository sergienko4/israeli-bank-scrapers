/**
 * Declarative login phase — calls a bank-provided login function.
 * The bank's pipeline config provides the login logic; this phase just invokes it.
 * Default stub passes through for testing.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Bank-provided login function signature. */
type LoginFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/**
 * Create a login step bound to a bank-provided function.
 * @param loginFn - The bank's login function.
 * @returns A pipeline step for login.
 */
function createLoginStep(loginFn: LoginFn): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'declarative-login',
    /** @inheritdoc */
    execute: (_ctx, input) => loginFn(input),
  };
}

/**
 * Default stub — passes through for testing.
 * @param _ctx - Unused.
 * @param input - Passed through.
 * @returns Success with unchanged context.
 */
function stubLogin(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Default stub step (used when builder hasn't wired a real login fn). */
const DECLARATIVE_LOGIN_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'declarative-login',
  execute: stubLogin,
};

export type { LoginFn };
export default DECLARATIVE_LOGIN_STEP;
export { createLoginStep, DECLARATIVE_LOGIN_STEP };
