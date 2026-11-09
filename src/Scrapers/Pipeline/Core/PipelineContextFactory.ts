/**
 * Pipeline context factory — builds the initial context from descriptor.
 */

import type { ScraperCredentials } from '../../Base/Interface.js';
import { getDebug as createLogger } from '../Logging/Debug.js';
import { resolvePipelineBankConfig } from '../Registry/Config/PipelineBankConfig.js';
import { none } from '../Types/Option.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import { resolveHeadlessApiMediator } from './HeadlessMediatorWiring.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Context fields every phase output starts without. */
type EmptySlots = Pick<
  IPipelineContext,
  'windowEnd' | 'scrape' | 'durableAuth' | 'balanceResolution'
>;

/**
 * Resolve DI dependencies for the initial context.
 * @param descriptor - The pipeline descriptor.
 * @param credentials - User credentials.
 * @returns Core context fields.
 */
function resolveCoreDeps(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Pick<IPipelineContext, 'options' | 'credentials' | 'companyId' | 'logger' | 'config'> {
  const companyId = descriptor.options.companyId;
  const logger = createLogger(`pipeline-${companyId}`);
  const resolved = resolvePipelineBankConfig(companyId);
  const config = resolved || {
    urls: { base: '' },
    balanceKind: 'card-cycle' as const,
    authStrategyKind: 'token' as const,
  };
  return { options: descriptor.options, credentials, companyId, logger, config };
}

/**
 * Build the Option slots that phases fill in as they run.
 * @returns Every slot set to none().
 */
function emptySlots(): EmptySlots {
  return {
    windowEnd: none(),
    scrape: none(),
    durableAuth: none(),
    balanceResolution: none(),
  };
}

/**
 * Build the initial pipeline context from descriptor.
 * @param descriptor - The pipeline descriptor.
 * @param credentials - User credentials.
 * @returns The initial context with all phase fields set to none().
 */
function buildInitialContext(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): IPipelineContext {
  const core = resolveCoreDeps(descriptor, credentials);
  const apiMediator = resolveHeadlessApiMediator(descriptor);
  const slots = emptySlots();
  return { ...core, apiMediator, ...slots };
}

export default buildInitialContext;
export { buildInitialContext };
