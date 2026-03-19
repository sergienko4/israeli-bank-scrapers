/**
 * Pipeline registry — maps CompanyTypes to pipeline builder functions.
 * All config resolved here — scrapers receive config via IPipelineContext.
 * Banks register here as they are migrated.
 */

import type { CompanyTypes } from '../../Definitions.js';
import { CompanyTypes as CT } from '../../Definitions.js';
import type { ScraperOptions } from '../Base/Interface.js';
import { buildDiscountPipeline } from '../Discount/DiscountPipeline.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Factory that builds a pipeline descriptor for a specific bank. */
type PipelineFactory = (options: ScraperOptions) => IPipelineDescriptor;

/** Registry of bank pipeline factories — populated during migration. */
const PIPELINE_REGISTRY: Partial<Record<CompanyTypes, PipelineFactory>> = {
  [CT.Discount]: buildDiscountPipeline,
};

export type { PipelineFactory };
export { PIPELINE_REGISTRY };
