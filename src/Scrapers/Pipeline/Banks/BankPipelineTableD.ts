/**
 * Bank pipeline table, shard D (PayBox through Yahav). Pepper's GraphQL
 * queries register at module load, as they did in its pipeline wrapper.
 */

// Side-effect import: register Pepper GraphQL queries into WK.
import './Pepper/graphql/PepperQueries.js';

import { CompanyTypes } from '../../../Definitions.js';
import { PAYBOX_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigPayBox.js';
import PEPPER_API_DIRECT_CALL from '../Registry/Config/PipelineBankConfigPepper.js';
import VISACAL_API_DIRECT_CALL from '../Registry/Config/PipelineBankConfigVisaCal.js';
import { YAHAV_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigYahav.js';
import PAYBOX_SHAPE from './PayBox/scrape/PayBoxShape.js';
import PEPPER_SHAPE from './Pepper/scrape/PepperShape.js';
import { bankEntry, type IBankPipelineEntry } from './PipelineTableBuilder.js';
import VISACAL_SHAPE from './VisaCal/scrape/VisaCalShape.js';
import YAHAV_SHAPE from './Yahav/scrape/YahavShape.js';

const BANK_PIPELINE_TABLE_D: Partial<Record<CompanyTypes, IBankPipelineEntry>> = {
  [CompanyTypes.PayBox]: bankEntry(PAYBOX_API_DIRECT_CALL, PAYBOX_SHAPE),
  [CompanyTypes.Pepper]: bankEntry(PEPPER_API_DIRECT_CALL, PEPPER_SHAPE),
  [CompanyTypes.VisaCal]: bankEntry(VISACAL_API_DIRECT_CALL, VISACAL_SHAPE),
  [CompanyTypes.Yahav]: bankEntry(YAHAV_API_DIRECT_CALL, YAHAV_SHAPE),
};

export default BANK_PIPELINE_TABLE_D;
