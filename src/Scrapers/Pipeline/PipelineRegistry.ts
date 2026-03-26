/**
 * Pipeline registry — maps CompanyTypes to pipeline builder functions.
 * All config resolved here — scrapers receive config via IPipelineContext.
 * Banks register here as they are migrated.
 */

import type { CompanyTypes } from '../../Definitions.js';
import { CompanyTypes as CT } from '../../Definitions.js';
import type { ScraperOptions } from '../Base/Interface.js';
import { buildAmexPipeline } from './Banks/Amex/AmexPipeline.js';
import { buildDiscountPipeline } from './Banks/Discount/DiscountPipeline.js';
import { buildIsracardPipeline } from './Banks/Isracard/IsracardPipeline.js';
import { buildVisaCalPipeline } from './Banks/VisaCal/VisaCalPipeline.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import type { Procedure } from './Types/Procedure.js';

/** Factory that builds a pipeline descriptor for a specific bank. */
type PipelineFactory = (options: ScraperOptions) => Procedure<IPipelineDescriptor>;

/** Registry of bank pipeline factories — populated during migration. */
const PIPELINE_REGISTRY: Partial<Record<CompanyTypes, PipelineFactory>> = {
  [CT.Amex]: buildAmexPipeline,
  [CT.Discount]: buildDiscountPipeline,
  [CT.Isracard]: buildIsracardPipeline,
  [CT.VisaCal]: buildVisaCalPipeline,
};

export type { PipelineFactory };
export { PIPELINE_REGISTRY };
