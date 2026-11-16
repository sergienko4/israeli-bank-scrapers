/**
 * Bank pipeline table, shard B (Leumi through Mercantile). Leumi keeps its
 * start-date gate here instead of a dedicated pipeline wrapper.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import { LEUMI_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigLeumi.js';
import { MASSAD_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigMassad.js';
import { MAX_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigMax.js';
import { MERCANTILE_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigMercantile.js';
import { fail, type Procedure, succeed } from '../Types/Procedure.js';
import LEUMI_SHAPE from './Leumi/scrape/LeumiShape.js';
import MASSAD_SHAPE from './Massad/scrape/MassadShape.js';
import MAX_SHAPE from './Max/scrape/MaxShape.js';
import MERCANTILE_SHAPE from './Mercantile/scrape/MercantileShape.js';
import { bankEntry, type IBankPipelineEntry } from './PipelineTableBuilder.js';

/**
 * Whether the options carry a finite start date.
 * @param options - Scraper options from the user.
 * @returns True for a valid Date instance.
 */
function hasValidStartDate(options: ScraperOptions): boolean {
  const start = options.startDate;
  if (!(start instanceof Date)) return false;
  const time = start.getTime();
  return Number.isFinite(time);
}

/**
 * Leumi's pre-build gate.
 * @param options - Scraper options from the user.
 * @returns Success, or Leumi's start-date failure.
 */
function leumiGate(options: ScraperOptions): Procedure<true> {
  if (hasValidStartDate(options)) return succeed(true);
  return fail(ScraperErrorTypes.Generic, 'Leumi startDate must be a valid date');
}

const BANK_PIPELINE_TABLE_B: Partial<Record<CompanyTypes, IBankPipelineEntry>> = {
  [CompanyTypes.Leumi]: bankEntry(LEUMI_API_DIRECT_CALL, LEUMI_SHAPE, leumiGate),
  [CompanyTypes.Massad]: bankEntry(MASSAD_API_DIRECT_CALL, MASSAD_SHAPE),
  [CompanyTypes.Max]: bankEntry(MAX_API_DIRECT_CALL, MAX_SHAPE),
  [CompanyTypes.Mercantile]: bankEntry(MERCANTILE_API_DIRECT_CALL, MERCANTILE_SHAPE),
};

export default BANK_PIPELINE_TABLE_B;
