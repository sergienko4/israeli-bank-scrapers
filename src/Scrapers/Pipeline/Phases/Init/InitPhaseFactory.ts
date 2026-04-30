/**
 * INIT phase factory + legacy INIT_STEP compat.
 * Extracted from InitPhase.ts to respect max-lines.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { InitPhase } from './InitPhase.js';

/**
 * Create the INIT phase instance.
 * @returns InitPhase with PRE/ACTION/POST/FINAL.
 */
function createInitPhase(): InitPhase {
  return Reflect.construct(InitPhase, []);
}

/**
 * Legacy compat — tests reference INIT_STEP.execute(ctx, input).
 * Delegates to createInitPhase().run(input).
 */
const INIT_STEP = {
  name: 'init-browser',
  /**
   * Execute init via BasePhase.run().
   * @param _ctx - Unused (compat).
   * @param input - Pipeline context.
   * @returns Procedure result.
   */
  execute: (
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> => {
    const phase = createInitPhase();
    return phase.run(input);
  },
};

export { createInitPhase, INIT_STEP };
