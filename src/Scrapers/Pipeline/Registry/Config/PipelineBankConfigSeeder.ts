/**
 * Seed WK URL registry from PIPELINE_BANK_CONFIG at module load.
 * Keeps every headless URL in one canonical place (the bank config)
 * while still making identityBase / graphql / identity.* paths
 * resolvable via WK for ApiMediator.apiPost.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import type { WKUrlGroup } from '../WK/UrlsWK.js';
import { registerWkUrl } from '../WK/UrlsWK.js';
import type { IHeadlessUrlsConfig, IPipelineBankConfig } from './PipelineBankConfig.js';

/** Whether a single WK URL entry was written into the registry. */
type WasUrlSeeded = boolean;
/** Whether a headless block's URLs were all seeded. */
type WasHeadlessSeeded = boolean;
/** Whether a [bankId,config] entry produced a seeding pass. */
type WasEntrySeeded = boolean;
/** Whether the full seeding pass over the registry completed. */
type WasRegistrySeeded = boolean;

/**
 * Register a single path entry when the URL is present.
 * @param bankHint - Bank identifier.
 * @param key - WK URL group key.
 * @param url - URL string (may be absent).
 * @returns True once processed.
 */
function seedOnePath(bankHint: CompanyTypes, key: string, url?: string): WasUrlSeeded {
  if (!url) return false;
  registerWkUrl(key as WKUrlGroup, bankHint, url);
  return true;
}

/**
 * Register every URL in a headless block into WK for the given bank.
 * Iterates `paths` generically so any bank can plug its own key subset.
 * @param bankHint - Bank identifier.
 * @param headless - Headless URLs block.
 * @returns True once all entries are written.
 */
function seedWkFromHeadless(
  bankHint: CompanyTypes,
  headless: IHeadlessUrlsConfig,
): WasHeadlessSeeded {
  registerWkUrl('identityBase', bankHint, headless.identityBase);
  registerWkUrl('graphql', bankHint, headless.graphql);
  for (const [key, url] of Object.entries(headless.paths)) seedOnePath(bankHint, key, url);
  return true;
}

/**
 * Seed one [bankId, config] entry from the PIPELINE_BANK_CONFIG map.
 * Skips banks with no headless block (HTML banks).
 * @param entry - Tuple from Object.entries(PIPELINE_BANK_CONFIG).
 * @returns True when a headless block was seeded; false when skipped.
 */
function seedOneEntry(entry: [string, IPipelineBankConfig]): WasEntrySeeded {
  const [key, config] = entry;
  if (!config.headless) return false;
  return seedWkFromHeadless(key as CompanyTypes, config.headless);
}

/**
 * Iterate PIPELINE_BANK_CONFIG and write every headless URL into WK.
 * Called once at bank-config module load.
 * @param registry - The pipeline bank registry map.
 * @returns True after the pass completes.
 */
function seedWkFromPipelineConfig(
  registry: Partial<Record<CompanyTypes, IPipelineBankConfig>>,
): WasRegistrySeeded {
  const entries = Object.entries(registry);
  entries.forEach(seedOneEntry);
  return true;
}

export default seedWkFromPipelineConfig;
export { seedWkFromPipelineConfig };
