/**
 * Terminate phase — cleanup browser resources in LIFO order.
 * Stub: returns succeed(input) until Step 3.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Stub: run reverse-order cleanup handlers.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeTerminate(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Terminate step — runs reverse-order cleanup handlers. */
const TERMINATE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'terminate',
  execute: executeTerminate,
};

export default TERMINATE_STEP;
export { TERMINATE_STEP };
