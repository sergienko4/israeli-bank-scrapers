/**
 * SimplePhase — test double that wraps a single action step into a BasePhase.
 * Phases built with it only need ACTION; pre/post/final are BasePhase no-ops.
 */

import { BasePhase } from '../../../../Scrapers/Pipeline/Phases/Base/BasePhase.js';
import type PhaseName from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Execute function type for SimplePhase action delegation. */
type ActionExecFn = (
  ctx: IActionContext,
  input: IActionContext,
) => Promise<Procedure<IActionContext>>;

/** SimplePhase — action-only phase with default no-op pre/post/final. */
class SimplePhase extends BasePhase {
  public readonly name: PhaseName;

  private readonly _action: ActionExecFn;

  /**
   * Create a simple phase with only an action.
   * @param phaseName - Phase identifier.
   * @param actionFn - The action function to execute.
   */
  constructor(phaseName: PhaseName, actionFn: ActionExecFn) {
    super();
    this.name = phaseName;
    this._action = actionFn;
  }

  /**
   * ACTION — delegates to the wrapped function (sealed context).
   * @param ctx - Sealed action context.
   * @param input - Sealed action context.
   * @returns Result from the wrapped action.
   */
  public async action(
    ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    return this._action(ctx, input);
  }
}

export type { ActionExecFn };
export { SimplePhase };
