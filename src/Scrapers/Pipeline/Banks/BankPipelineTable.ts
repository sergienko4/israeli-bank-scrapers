/**
 * The one bank pipeline table. Each shard is a disjoint slice kept under the
 * dependency cap; the merged table is the single place a bank's config and
 * shape meet.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import BANK_PIPELINE_TABLE_A from './BankPipelineTableA.js';
import BANK_PIPELINE_TABLE_B from './BankPipelineTableB.js';
import BANK_PIPELINE_TABLE_C from './BankPipelineTableC.js';
import BANK_PIPELINE_TABLE_D from './BankPipelineTableD.js';
import type { IBankPipelineEntry } from './PipelineTableBuilder.js';

const BANK_PIPELINE_TABLE: Partial<Record<CompanyTypes, IBankPipelineEntry>> = {
  ...BANK_PIPELINE_TABLE_A,
  ...BANK_PIPELINE_TABLE_B,
  ...BANK_PIPELINE_TABLE_C,
  ...BANK_PIPELINE_TABLE_D,
};

export default BANK_PIPELINE_TABLE;
