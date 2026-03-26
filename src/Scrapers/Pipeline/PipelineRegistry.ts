/**
 * Pipeline registry — maps CompanyTypes to pipeline builder functions.
 * All config resolved here — scrapers receive config via IPipelineContext.
 * Banks register here as they are migrated.
 */

import type { CompanyTypes } from '../../Definitions.js';
import { CompanyTypes as CT } from '../../Definitions.js';
import type { ScraperOptions } from '../Base/Interface.js';
import { buildDiscountPipeline } from './Banks/Discount/DiscountPipeline.js';
import { buildVisaCalPipeline } from './Banks/VisaCal/VisaCalPipeline.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import type { Procedure } from './Types/Procedure.js';

/** Factory that builds a pipeline descriptor for a specific bank. */
type PipelineFactory = (options: ScraperOptions) => Procedure<IPipelineDescriptor>;

/** Registry of bank pipeline factories — populated during migration. */
// Amex + Isracard use API-based login (ProxyRequestHandler.ashx) — not browser form fill.
// Their old scrapers handle this correctly. Register here when an ApiLoginStrategy exists.
const PIPELINE_REGISTRY: Partial<Record<CompanyTypes, PipelineFactory>> = {
  [CT.Discount]: buildDiscountPipeline,
  [CT.VisaCal]: buildVisaCalPipeline,
};

export type { PipelineFactory };
export { PIPELINE_REGISTRY };
