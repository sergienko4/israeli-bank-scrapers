import { CompanyTypes } from '../../../Definitions.js';
import type { PipelineFactory } from '../Core/PipelineDescriptor.js';
import { buildMercantilePipeline } from './Mercantile/MercantilePipeline.js';
import { buildOneZeroPipeline } from './OneZero/OneZeroPipeline.js';
import { buildOtsarHahayalPipeline } from './OtsarHahayal/OtsarHahayalPipeline.js';
import { buildPagiPipeline } from './Pagi/PagiPipeline.js';
import { buildPayBoxPipeline } from './PayBox/PayBoxPipeline.js';
import { buildPepperPipeline } from './Pepper/PepperPipeline.js';
import { buildVisaCalPipeline } from './VisaCal/VisaCalPipeline.js';

/**
 * Pipeline registry for banks Mercantile through VisaCal (alphabetical second
 * half). Split to stay within the max-dependencies limit, mirroring the legacy
 * SCRAPER_REGISTRY split.
 */
const PIPELINE_REGISTRY_MERCANTILE_TO_VISACAL: Partial<Record<CompanyTypes, PipelineFactory>> = {
  [CompanyTypes.Mercantile]: buildMercantilePipeline,
  [CompanyTypes.OneZero]: buildOneZeroPipeline,
  [CompanyTypes.OtsarHahayal]: buildOtsarHahayalPipeline,
  [CompanyTypes.Pagi]: buildPagiPipeline,
  [CompanyTypes.PayBox]: buildPayBoxPipeline,
  [CompanyTypes.Pepper]: buildPepperPipeline,
  [CompanyTypes.VisaCal]: buildVisaCalPipeline,
};

export default PIPELINE_REGISTRY_MERCANTILE_TO_VISACAL;
