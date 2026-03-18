/**
 * Dashboard phase — waits for dashboard indicators.
 * Stub: returns succeed(input) until Step 6.
 */

import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/**
 * Stub: wait for dashboard readiness.
 * @param _ctx - Pipeline context (unused in stub).
 * @param input - Input context to pass through.
 * @returns Success with unchanged context.
 */
function executeDashboard(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Dashboard step — waits for dashboard readiness via IElementMediator. */
const DASHBOARD_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'dashboard',
  execute: executeDashboard,
};

export default DASHBOARD_STEP;
export { DASHBOARD_STEP };
