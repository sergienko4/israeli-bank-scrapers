/**
 * Token-strategy construction for the ApiDirectCall ACTION stage.
 *
 * <p>The durable device-auth mode is resolved here, before any auth request,
 * and handed to the strategy privately — never through creds or carry. An
 * invalid option combination fails before the strategy exists.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import { resolveContextAuthMode } from './ApiDirectCallActions.pre.js';
import type { IApiDirectCallConfig } from './ConfigContracts/index.js';
import {
  createTokenStrategyFromConfig,
  type IConfigTokenStrategy,
} from './Flow/TokenStrategyFromConfig.js';

/**
 * Build the bank's token strategy for this run's durable mode.
 * @param config - API-direct-call config.
 * @param ctx - Normalised pipeline context.
 * @returns Strategy procedure, or a category-only option-validation failure.
 */
function createContextStrategy(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Procedure<IConfigTokenStrategy> {
  const modeProc = resolveContextAuthMode(config, ctx);
  if (!isOk(modeProc)) return modeProc;
  return createTokenStrategyFromConfig({ config, persistentAuth: modeProc.value });
}

export default createContextStrategy;

export { createContextStrategy };
