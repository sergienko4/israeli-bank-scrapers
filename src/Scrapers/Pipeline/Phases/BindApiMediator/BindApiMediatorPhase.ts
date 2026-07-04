/**
 * BIND-API-MEDIATOR phase - provisions a browser-page ApiMediator for
 * browser hard-model banks, inserted between auth (LOGIN/OTP-*) and
 * API-DIRECT-SCRAPE. Headless banks already carry a mediator (wired by
 * PipelineContextFactory) so this phase is absent from their chain and,
 * if ever reached, is a no-op (idempotent - see {@link bindBrowserPageMediator}).
 *
 * The bind runs in the PRE stage - the only stage that receives the full
 * {@link IPipelineContext} carrying the live `browser` slot. The sealed
 * ACTION context strips `browser`/`page`/`mediator` by construction (see
 * `buildActionContext`), so a page-bound mediator cannot be built there;
 * ACTION is a no-op passthrough. Thin orchestration only: the bind logic
 * lives in BindApiMediatorActions so the per-file LOC ceiling holds. Zero
 * bank coupling per Rule #11.
 */

import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { bindBrowserPageMediator } from './BindApiMediatorActions.js';

/** BIND-API-MEDIATOR phase - binds a browser-page mediator in PRE. */
class BindApiMediatorPhase extends BasePhase {
  public readonly name = 'bind-api-mediator' as const;

  /**
   * PRE - bind the browser-page mediator using the full context's live
   * `browser` slot, then prime auth. Idempotent: a pre-populated
   * apiMediator (headless banks) passes through unchanged. Runs here - not
   * ACTION - because the sealed action context strips `browser`.
   * @param _ctx - Unused incoming context.
   * @param input - Full pipeline context (carries the live browser).
   * @returns Context carrying the primed browser-page mediator, or failure.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'bind-api-mediator.pre' });
    return bindBrowserPageMediator(input);
  }

  /**
   * ACTION - no-op passthrough. The bind already ran in PRE; `apiMediator`
   * rides the discovery slice so it survives the seal + merge unchanged.
   * The sealed context has no `browser`, so binding cannot happen here.
   * @param _ctx - Unused sealed context.
   * @param input - Sealed action context threaded forward.
   * @returns Input unchanged.
   */
  public action(_ctx: IActionContext, input: IActionContext): Promise<Procedure<IActionContext>> {
    input.logger.debug({ phase: this.name, message: 'bind-api-mediator.action' });
    const result = succeed(input);
    return Promise.resolve(result);
  }
}

/**
 * Build the BIND-API-MEDIATOR phase instance.
 * @returns BindApiMediatorPhase named 'bind-api-mediator'.
 */
function createBindApiMediatorPhase(): BindApiMediatorPhase {
  return Reflect.construct(BindApiMediatorPhase, []);
}

export default createBindApiMediatorPhase;
export { BindApiMediatorPhase, createBindApiMediatorPhase };
