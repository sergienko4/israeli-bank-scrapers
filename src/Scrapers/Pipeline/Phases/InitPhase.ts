/**
 * Init phase — browser launch + page setup + mediator creation.
 * Stub: returns succeed(input) until Step 3.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Stub: init browser context and page.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeInit(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Init phase step — launches browser and creates page. */
const INIT_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'init-browser',
  execute: executeInit,
};

export default INIT_STEP;
export { INIT_STEP };
