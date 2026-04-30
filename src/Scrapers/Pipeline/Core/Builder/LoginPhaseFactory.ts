/**
 * Declarative login phase — wraps LoginSteps pre/action/post into BasePhase.
 * Extracted from PipelineBuilder.ts to respect max-classes-per-file.
 */

import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import executeLoginSignal from '../../Mediator/Auth/LoginSignalProbe.js';
import { createLoginPhase } from '../../Mediator/Login/LoginSteps.js';
import type { BasePhase } from '../../Types/BasePhase.js';
import type { PhaseName } from '../../Types/Phase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { ActionExecFn } from '../../Types/SimplePhase.js';
import { SimplePhase } from '../../Types/SimplePhase.js';

type StepResult = Promise<Procedure<IPipelineContext>>;
type ActionResult = Promise<Procedure<IActionContext>>;
type Ctx = IPipelineContext;

/** Declarative login phase with pre/action/post from LoginSteps. */
class DeclarativeLogin extends SimplePhase {
  private readonly _phase: ReturnType<typeof createLoginPhase>;

  /**
   * Create declarative login.
   * @param name - Phase name.
   * @param exec - Action execute function.
   * @param phase - Login phase steps.
   */
  constructor(name: PhaseName, exec: ActionExecFn, phase: ReturnType<typeof createLoginPhase>) {
    super(name, exec);
    this._phase = phase;
  }

  /**
   * PreLogin.
   * @param ctx - Context.
   * @param input - Input.
   * @returns Updated context.
   */
  public async pre(ctx: Ctx, input: Ctx): StepResult {
    void this.name;
    return this._phase.pre.execute(ctx, input);
  }

  /**
   * PostLogin.
   * @param ctx - Context.
   * @param input - Input.
   * @returns Success or error.
   */
  public async post(ctx: Ctx, input: Ctx): StepResult {
    void this.name;
    return this._phase.post.execute(ctx, input);
  }

  /**
   * SIGNAL: cookie audit + REVEAL probe.
   * @param _ctx - Unused.
   * @param input - Context.
   * @returns Succeed or fail.
   */
  public async final(_ctx: Ctx, input: Ctx): StepResult {
    void this.name;
    return await executeLoginSignal(input);
  }
}

/**
 * Build stub full context from sealed action context.
 * @param input - Sealed action context.
 * @returns Full pipeline context with none() stubs.
 */
function buildStubFullContext(input: IActionContext): IPipelineContext {
  return {
    ...input,
    mediator: { has: false },
    browser: { has: false },
    login: { has: false },
    scrape: { has: false },
  } as IPipelineContext;
}

/**
 * Create exec fn that delegates to LoginSteps action.
 * @param phase - Login phase steps.
 * @returns ActionExecFn for DeclarativeLogin.
 */
function buildExecFn(phase: ReturnType<typeof createLoginPhase>): ActionExecFn {
  return async (_ctx: IActionContext, input: IActionContext): ActionResult => {
    const full = buildStubFullContext(input);
    const result = await phase.action.execute(full, full);
    if (!result.success) return fail(result.errorType, result.errorMessage);
    return succeed({ ...input, diagnostics: result.value.diagnostics });
  };
}

/**
 * Build a declarative login phase from ILoginConfig.
 * @param config - Bank's login config.
 * @returns A BasePhase with pre/action/post from LoginSteps.
 */
function buildDeclarativePhase(config: ILoginConfig): BasePhase {
  const phase = createLoginPhase(config);
  const exec = buildExecFn(phase);
  return Reflect.construct(DeclarativeLogin, ['login', exec, phase]) as BasePhase;
}

export default buildDeclarativePhase;
export { buildDeclarativePhase };
