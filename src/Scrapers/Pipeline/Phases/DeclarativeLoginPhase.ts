/**
 * Declarative login phase — function-based and stub login steps.
 *
 * This file owns two things:
 * 1. createLoginStep(fn) — wraps a custom bank-provided login function (directPost etc.)
 * 2. DECLARATIVE_LOGIN_STEP — pass-through stub for testing and unimplemented modes
 *
 * ILoginConfig-based banks (Discount, VisaCal) use createLoginPhase() from LoginSteps.ts,
 * which implements the full pre/action/post pattern via ctx.mediator (black box).
 * This file is NOT used for those banks.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Bank-provided login function signature. */
type LoginFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/**
 * Create a login step from a custom bank-provided function.
 * Used for directPost, native, or any non-ILoginConfig login mode.
 * @param loginFn - Bank's custom login function.
 * @returns Pipeline step for login.
 */
function createLoginStep(loginFn: LoginFn): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'declarative-login',
    /**
     * Execute the custom login function provided by the bank.
     * @param _ctx - Unused pipeline context.
     * @param input - Context with browser state.
     * @returns Login result from the bank-provided function.
     */
    async execute(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return loginFn(input);
    },
  };
}

/**
 * Default stub — passes through for testing and unimplemented login modes.
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

/** Default stub step — used when no login mode is configured. */
const DECLARATIVE_LOGIN_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'declarative-login',
  execute: stubLogin,
};

export type { LoginFn };
export default DECLARATIVE_LOGIN_STEP;
export { createLoginStep, DECLARATIVE_LOGIN_STEP };
