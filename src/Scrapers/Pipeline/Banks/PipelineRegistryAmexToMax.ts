import { CompanyTypes } from '../../../Definitions.js';
import type { PipelineFactory } from '../Core/PipelineDescriptor.js';
import { buildAmexPipeline } from './Amex/AmexPipeline.js';
import { buildBeinleumiPipeline } from './Beinleumi/BeinleumiPipeline.js';
import { buildDiscountPipeline } from './Discount/DiscountPipeline.js';
import { buildHapoalimPipeline } from './Hapoalim/HapoalimPipeline.js';
import { buildIsracardPipeline } from './Isracard/IsracardPipeline.js';
import { buildMassadPipeline } from './Massad/MassadPipeline.js';
import { buildMaxPipeline } from './Max/MaxPipeline.js';

/**
 * Pipeline registry for banks Amex through Max (alphabetical first half).
 * Split to stay within the max-dependencies limit, mirroring the legacy
 * SCRAPER_REGISTRY split.
 */
const PIPELINE_REGISTRY_AMEX_TO_MAX: Partial<Record<CompanyTypes, PipelineFactory>> = {
  [CompanyTypes.Amex]: buildAmexPipeline,
  [CompanyTypes.Beinleumi]: buildBeinleumiPipeline,
  [CompanyTypes.Discount]: buildDiscountPipeline,
  [CompanyTypes.Hapoalim]: buildHapoalimPipeline,
  [CompanyTypes.Isracard]: buildIsracardPipeline,
  [CompanyTypes.Massad]: buildMassadPipeline,
  [CompanyTypes.Max]: buildMaxPipeline,
};

export default PIPELINE_REGISTRY_AMEX_TO_MAX;
