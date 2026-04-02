/**
 * Declarative login phase — wraps LoginSteps pre/action/post into BasePhase.
 * Extracted from PipelineBuilder.ts to respect max-classes-per-file.
 */

import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import executeLoginSignal from '../Mediator/Auth/LoginSignalProbe.js';
import { createLoginPhase } from '../Phases/Login/LoginSteps.js';
import type { BasePhase } from '../Types/BasePhase.js';
import type { IPipelineStep, PhaseName } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { SimplePhase } from '../Types/SimplePhase.js';

type StepExecFn = IPipelineStep<IPipelineContext, IPipelineContext>['execute'];
type StepResult = Promise<Procedure<IPipelineContext>>;
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
  constructor(name: PhaseName, exec: StepExecFn, phase: ReturnType<typeof createLoginPhase>) {
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
 * Build a declarative login phase from ILoginConfig.
 * @param config - Bank's login config.
 * @returns A BasePhase with pre/action/post from LoginSteps.
 */
function buildDeclarativePhase(config: ILoginConfig): BasePhase {
  const phase = createLoginPhase(config);
  /**
   * Delegate to action step.
   * @param ctx - Pipeline context.
   * @param input - Pipeline input.
   * @returns Step result.
   */
  const exec: StepExecFn = (ctx: Ctx, input: Ctx): StepResult => phase.action.execute(ctx, input);
  return Reflect.construct(DeclarativeLogin, ['login', exec, phase]) as BasePhase;
}

export default buildDeclarativePhase;
export { buildDeclarativePhase };
