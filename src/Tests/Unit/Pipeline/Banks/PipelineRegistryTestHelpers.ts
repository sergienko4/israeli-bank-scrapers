/**
 * Test helper for reading a bank's registered pipeline factory. The registry
 * is the production entry point now that the per-bank wrapper files are gone.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import PIPELINE_REGISTRY from '../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import type { PipelineFactory } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';

/** Every public bank id, in enum order. */
const REGISTERED_BANKS: readonly CompanyTypes[] = Object.values(CompanyTypes);

/**
 * Read a registered bank's factory, failing test setup when it is absent.
 * @param companyId - Bank id.
 * @returns The bank's pipeline factory.
 */
function factoryOf(companyId: CompanyTypes): PipelineFactory {
  const factory = PIPELINE_REGISTRY[companyId];
  if (factory === undefined) throw new ScraperError(`pipeline not registered: ${companyId}`);
  return factory;
}

export { factoryOf, REGISTERED_BANKS };
