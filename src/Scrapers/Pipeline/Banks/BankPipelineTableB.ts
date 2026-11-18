/**
 * Bank pipeline table, shard B (Leumi through Mercantile).
 */

import { CompanyTypes } from '../../../Definitions.js';
import { LEUMI_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigLeumi.js';
import { MASSAD_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigMassad.js';
import { MAX_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigMax.js';
import { MERCANTILE_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigMercantile.js';
import LEUMI_SHAPE from './Leumi/scrape/LeumiShape.js';
import MASSAD_SHAPE from './Massad/scrape/MassadShape.js';
import MAX_SHAPE from './Max/scrape/MaxShape.js';
import MERCANTILE_SHAPE from './Mercantile/scrape/MercantileShape.js';
import { bankEntry, type IBankPipelineEntry } from './PipelineTableBuilder.js';

const BANK_PIPELINE_TABLE_B: Partial<Record<CompanyTypes, IBankPipelineEntry>> = {
  [CompanyTypes.Leumi]: bankEntry(LEUMI_API_DIRECT_CALL, LEUMI_SHAPE),
  [CompanyTypes.Massad]: bankEntry(MASSAD_API_DIRECT_CALL, MASSAD_SHAPE),
  [CompanyTypes.Max]: bankEntry(MAX_API_DIRECT_CALL, MAX_SHAPE),
  [CompanyTypes.Mercantile]: bankEntry(MERCANTILE_API_DIRECT_CALL, MERCANTILE_SHAPE),
};

export default BANK_PIPELINE_TABLE_B;
