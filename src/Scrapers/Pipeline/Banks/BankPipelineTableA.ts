/**
 * Bank pipeline table, shard A (Amex through Isracard). Each entry pairs the
 * bank's api-direct call config with its scrape shape; the generic builder
 * turns the entry into the registry factory.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { AMEX_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigAmex.js';
import { BEINLEUMI_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigBeinleumi.js';
import { DISCOUNT_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigDiscount.js';
import { HAPOALIM_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigHapoalim.js';
import { ISRACARD_API_DIRECT_CALL } from '../Registry/Config/PipelineBankConfigIsracard.js';
import AMEX_SHAPE from './Amex/scrape/AmexShape.js';
import BEINLEUMI_SHAPE from './Beinleumi/scrape/BeinleumiShape.js';
import DISCOUNT_SHAPE from './Discount/scrape/DiscountShape.js';
import HAPOALIM_SHAPE from './Hapoalim/scrape/HapoalimShape.js';
import ISRACARD_SHAPE from './Isracard/scrape/IsracardShape.js';
import { bankEntry, type IBankPipelineEntry } from './PipelineTableBuilder.js';

const BANK_PIPELINE_TABLE_A: Partial<Record<CompanyTypes, IBankPipelineEntry>> = {
  [CompanyTypes.Amex]: bankEntry(AMEX_API_DIRECT_CALL, AMEX_SHAPE),
  [CompanyTypes.Beinleumi]: bankEntry(BEINLEUMI_API_DIRECT_CALL, BEINLEUMI_SHAPE),
  [CompanyTypes.Discount]: bankEntry(DISCOUNT_API_DIRECT_CALL, DISCOUNT_SHAPE),
  [CompanyTypes.Hapoalim]: bankEntry(HAPOALIM_API_DIRECT_CALL, HAPOALIM_SHAPE),
  [CompanyTypes.Isracard]: bankEntry(ISRACARD_API_DIRECT_CALL, ISRACARD_SHAPE),
};

export default BANK_PIPELINE_TABLE_A;
