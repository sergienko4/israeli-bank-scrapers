/**
 * Bank pipeline table, shard C (Mizrahi through Pagi). OneZero's GraphQL
 * queries register at module load, as they did in its pipeline wrapper.
 */

// Side-effect import: register OneZero GraphQL queries into WK.
import './OneZero/graphql/OneZeroQueries.js';

import { CompanyTypes } from '../../../Definitions.js';
import { MIZRAHI_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigMizrahi.js';
import ONEZERO_API_DIRECT_CALL from '../Registry/Config/PipelineBankConfigOneZero.js';
import { OTSAR_HAHAYAL_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigOtsarHahayal.js';
import { PAGI_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigPagi.js';
import MIZRAHI_SHAPE from './Mizrahi/scrape/MizrahiShape.js';
import ONE_ZERO_SHAPE from './OneZero/scrape/OneZeroShape.js';
import OTSAR_HAHAYAL_SHAPE from './OtsarHahayal/scrape/OtsarHahayalShape.js';
import PAGI_SHAPE from './Pagi/scrape/PagiShape.js';
import { bankEntry, type IBankPipelineEntry } from './PipelineTableBuilder.js';

const BANK_PIPELINE_TABLE_C: Partial<Record<CompanyTypes, IBankPipelineEntry>> = {
  [CompanyTypes.Mizrahi]: bankEntry(MIZRAHI_API_DIRECT_CALL, MIZRAHI_SHAPE),
  [CompanyTypes.OneZero]: bankEntry(ONEZERO_API_DIRECT_CALL, ONE_ZERO_SHAPE),
  [CompanyTypes.OtsarHahayal]: bankEntry(OTSAR_HAHAYAL_API_DIRECT_CALL, OTSAR_HAHAYAL_SHAPE),
  [CompanyTypes.Pagi]: bankEntry(PAGI_API_DIRECT_CALL, PAGI_SHAPE),
};

export default BANK_PIPELINE_TABLE_C;
