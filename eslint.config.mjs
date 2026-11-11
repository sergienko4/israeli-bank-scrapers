// @ts-check
/**
 * ESLint flat config — ordered composition only.
 *
 * Every config block lives under `eslint/clusters/` and every rule definition
 * or shared option under `eslint/rules/`. Flat-config precedence is
 * order-sensitive: a later block REPLACES `no-restricted-syntax` options
 * rather than merging them. The spread order below is therefore the contract.
 * Do not sort it.
 */
import tseslint from 'typescript-eslint';

import { BASE_BLOCKS } from './eslint/clusters/Base.mjs';
import { CLUSTER_CAP_BLOCKS } from './eslint/clusters/ClusterCaps.mjs';
import { FINAL_GUARD_BLOCKS } from './eslint/clusters/FinalGuards.mjs';
import { LEGACY_SUPPRESSION_BLOCKS } from './eslint/clusters/LegacySuppression.mjs';
import { MAIN_SOURCE_BLOCKS } from './eslint/clusters/MainSource.mjs';
import { PHASE3_AND_BASELINE_BLOCKS } from './eslint/clusters/Phase3AndBaseline.mjs';
import { PIPELINE_BLOCKS } from './eslint/clusters/PipelineBlocks.mjs';
import { SOURCE_QUALITY_BLOCKS } from './eslint/clusters/SourceQuality.mjs';
import { TEST_BLOCKS } from './eslint/clusters/TestBlocks.mjs';
import { TEST_CAP_BLOCKS } from './eslint/clusters/TestCaps.mjs';

export {
  PIPELINE_ARMED_SELECTORS,
  PIPELINE_CANARY_SELECTORS,
  PIPELINE_CANARY_SYNTAX_RULES,
  PIPELINE_KNOWN_NEW_SELECTORS,
  PIPELINE_LEGACY_SELECTORS,
  PIPELINE_PENDING_DRAIN_SELECTORS,
  PIPELINE_SCOPED_SYNTAX_EXTRAS,
  PIPELINE_SELECTOR_EXEMPTIONS,
  PIPELINE_SYNTAX_RULES,
  pipelineSyntaxExcept,
  scopedSelectorsForFile,
} from './eslint/rules/PipelineContract.mjs';
export {
  CANARY_EXTRA_MESSAGES,
  CANARY_EXTRA_SELECTORS,
} from './eslint/rules/CanaryRegistry.mjs';

export default tseslint.config(
  ...BASE_BLOCKS,
  ...MAIN_SOURCE_BLOCKS,
  ...TEST_BLOCKS,
  ...PIPELINE_BLOCKS,
  ...SOURCE_QUALITY_BLOCKS,
  ...LEGACY_SUPPRESSION_BLOCKS,
  ...CLUSTER_CAP_BLOCKS,
  ...PHASE3_AND_BASELINE_BLOCKS,
  ...TEST_CAP_BLOCKS,
  ...FINAL_GUARD_BLOCKS,
);
