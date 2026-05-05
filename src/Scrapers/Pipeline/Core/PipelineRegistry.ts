/**
 * Pipeline registry — maps CompanyTypes to pipeline builder functions.
 * All config resolved here — scrapers receive config via IPipelineContext.
 * Banks register here as they are migrated.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import { CompanyTypes as CT } from '../../../Definitions.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import { buildAmexPipeline } from '../Banks/Amex/AmexPipeline.js';
import { buildBeinleumiPipeline } from '../Banks/Beinleumi/BeinleumiPipeline.js';
import { buildDiscountPipeline } from '../Banks/Discount/DiscountPipeline.js';
import { buildHapoalimPipeline } from '../Banks/Hapoalim/HapoalimPipeline.js';
import { buildIsracardPipeline } from '../Banks/Isracard/IsracardPipeline.js';
import { buildMassadPipeline } from '../Banks/Massad/MassadPipeline.js';
import { buildMaxPipeline } from '../Banks/Max/MaxPipeline.js';
import { buildMercantilePipeline } from '../Banks/Mercantile/MercantilePipeline.js';
import { buildOneZeroPipeline } from '../Banks/OneZero/OneZeroPipeline.js';
import { buildOtsarHahayalPipeline } from '../Banks/OtsarHahayal/OtsarHahayalPipeline.js';
import { buildPagiPipeline } from '../Banks/Pagi/PagiPipeline.js';
import { buildPepperPipeline } from '../Banks/Pepper/PepperPipeline.js';
import { buildVisaCalPipeline } from '../Banks/VisaCal/VisaCalPipeline.js';
import type { Procedure } from '../Types/Procedure.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Factory that builds a pipeline descriptor for a specific bank. */
type PipelineFactory = (options: ScraperOptions) => Procedure<IPipelineDescriptor>;

/** Registry of bank pipeline factories — populated during migration. */
const PIPELINE_REGISTRY: Partial<Record<CompanyTypes, PipelineFactory>> = {
  [CT.Amex]: buildAmexPipeline,
  [CT.Beinleumi]: buildBeinleumiPipeline,
  [CT.Discount]: buildDiscountPipeline,
  [CT.Hapoalim]: buildHapoalimPipeline,
  [CT.Isracard]: buildIsracardPipeline,
  [CT.Max]: buildMaxPipeline,
  [CT.Massad]: buildMassadPipeline,
  [CT.Mercantile]: buildMercantilePipeline,
  [CT.OneZero]: buildOneZeroPipeline,
  [CT.OtsarHahayal]: buildOtsarHahayalPipeline,
  [CT.Pagi]: buildPagiPipeline,
  [CT.Pepper]: buildPepperPipeline,
  [CT.VisaCal]: buildVisaCalPipeline,
};

export type { PipelineFactory };
export { PIPELINE_REGISTRY };
