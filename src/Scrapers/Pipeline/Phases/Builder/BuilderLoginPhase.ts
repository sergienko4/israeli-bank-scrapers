/**
 * Declarative login phase — wraps LoginSteps pre/action/post into BasePhase.
 * Extracted from PipelineBuilder.ts to respect max-classes-per-file.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import type { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineStep, PhaseName } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { SimplePhase } from '../../Types/SimplePhase.js';
import { probeDashboardReveal } from '../Dashboard/DashboardPhase.js';
import { createLoginPhase } from '../Login/LoginSteps.js';

type StepExecFn = IPipelineStep<IPipelineContext, IPipelineContext>['execute'];
type StepResult = Promise<Procedure<IPipelineContext>>;
type Ctx = IPipelineContext;
/** Cookie summary string for audit logging. */
type CookieSummary = string;

/**
 * Log cookie audit for login signal.
 * @param mediator - Element mediator.
 * @param log - Logger.
 * @returns Cookie count.
 */
async function auditCookies(
  mediator: IElementMediator,
  log: IPipelineContext['logger'],
): Promise<number> {
  await mediator.waitForNetworkIdle(10000).catch((): false => false);
  const cookies = await mediator.getCookies();
  const names = cookies.map((c): CookieSummary => `${c.name}@${c.domain}`);
  const summary = names.join(', ');
  log.debug('[LOGIN.SIGNAL] cookies=%d [%s]', cookies.length, summary);
  const pageUrl = mediator.getCurrentUrl();
  log.debug('[LOGIN.SIGNAL] url=%s', pageUrl);
  return cookies.length;
}

/**
 * Execute LOGIN.SIGNAL: cookie audit + REVEAL probe.
 * @param input - Pipeline context.
 * @returns Succeed with diagnostics or fail.
 */
async function executeLoginSignal(input: IPipelineContext): StepResult {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN final: no login state');
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  const cookieCount = await auditCookies(mediator, input.logger);
  if (cookieCount === 0) {
    return fail(ScraperErrorTypes.Generic, 'LOGIN SIGNAL: AUTH_SESSION_INVALID — 0 cookies');
  }
  const revealInfo = await probeDashboardReveal(mediator);
  input.logger.debug('[LOGIN.SIGNAL] %s', revealInfo);
  const diag = { ...input.diagnostics, lastAction: `login-signal (${revealInfo})` };
  return succeed({ ...input, diagnostics: diag });
}

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
