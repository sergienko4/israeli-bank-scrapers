/**
 * Isolated public-factory harness for the inactive synthetic native candidate.
 */

import { createHash } from 'node:crypto';

import { CompanyTypes } from '../../../../../Definitions.js';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from '../../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import LEUMI_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
import PIPELINE_REGISTRY from '../../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import createPipelineBuilder from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilderFactory.js';
import type { PipelineFactory } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import createScraper from '../../../../../Scrapers/Registry/Factory.js';
import { SYNTHETIC_SDK } from './LeumiSyntheticWcf.js';

interface ICandidateModule {
  readonly LEUMI_API_DIRECT_CALL: IApiDirectCallConfig;
}

interface ISnapshot {
  readonly factory: PipelineFactory;
  readonly fetch: typeof globalThis.fetch;
}

interface IFactoryResult {
  readonly result: IScraperScrapingResult;
  readonly phases: readonly string[];
  readonly nativePhases: readonly string[];
}

const REGISTRY = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js';
const CANDIDATE = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumi.js';
const HINT = CompanyTypes.Leumi;
const OPTIONS = { companyId: HINT, startDate: new Date('2026-01-01') };

/**
 * Read the native Leumi factory before any synthetic swap.
 * @returns The registered native factory.
 */
function nativeLeumiFactory(): PipelineFactory {
  const factory = PIPELINE_REGISTRY[CompanyTypes.Leumi];
  if (factory === undefined) throw new ScraperError('Leumi pipeline not registered');
  return factory;
}

const LEUMI_FACTORY = nativeLeumiFactory();

/**
 * Bind the fake SDK bytes only to a cloned test configuration.
 * @param config - Production candidate configuration.
 * @returns Independent synthetic configuration.
 */
function syntheticConfig(config: IApiDirectCallConfig): IApiDirectCallConfig {
  const digest = createHash('sha256').update(SYNTHETIC_SDK).digest('hex');
  const steps = config.steps.map(step =>
    step.name === 'validate' && step.method === 'GET'
      ? { ...step, responseIntegrity: { maxBytes: 1048576, sha256: digest } }
      : step,
  );
  return { ...config, steps };
}

/**
 * Build an API-direct candidate through the normal descriptor builder.
 * @param config - Synthetic login configuration.
 * @returns Factory accepted by the public registry.
 */
function makeFactory(config: IApiDirectCallConfig): PipelineFactory {
  return (options: ScraperOptions): ReturnType<PipelineFactory> =>
    createPipelineBuilder().withOptions(options).withApiDirect(config, LEUMI_SHAPE).build();
}

/**
 * Save the registry entries that the test replaces.
 * @returns Snapshot used by cleanup.
 */
function snapshot(): ISnapshot {
  const factory = PIPELINE_REGISTRY[HINT];
  if (factory === undefined) throw new TypeError('missing registry');
  return { factory, fetch: globalThis.fetch };
}

/**
 * Restore the original public registry and fetch.
 * @param saved - Snapshot taken before replacement.
 * @returns True after cleanup.
 */
function restore(saved: ISnapshot): true {
  PIPELINE_REGISTRY[HINT] = saved.factory;
  globalThis.fetch = saved.fetch;
  return true;
}

/**
 * Activate the candidate in this test process only.
 * @param factory - Synthetic candidate factory.
 * @returns True after registering the test factory.
 */
function install(factory: PipelineFactory): true {
  PIPELINE_REGISTRY[HINT] = factory;
  return true;
}

/**
 * Runs the candidate through the public factory against a synthetic peer.
 * @param fetch - Offline peer transport.
 * @param creds - Synthetic credentials.
 * @returns Public result and descriptor phase names.
 */
async function runPublicFactory(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  creds: ScraperCredentials,
): Promise<IFactoryResult> {
  // The active config seeds every candidate route into WK on module load.
  await import(REGISTRY);
  const candidate = (await import(CANDIDATE)) as ICandidateModule;
  const saved = snapshot();
  const config = syntheticConfig(candidate.LEUMI_API_DIRECT_CALL);
  const factory = makeFactory(config);
  try {
    install(factory);
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const descriptor = factory(OPTIONS);
    if (!descriptor.success) throw new TypeError(descriptor.errorMessage);
    const native = LEUMI_FACTORY(OPTIONS);
    if (!native.success) throw new TypeError(native.errorMessage);
    const result = await createScraper(OPTIONS).scrape(creds);
    const phases = descriptor.value.phases.map(phase => phase.name);
    const nativePhases = native.value.phases.map(phase => phase.name);
    return { result, phases, nativePhases };
  } finally {
    restore(saved);
  }
}

export type { IFactoryResult };
export { runPublicFactory };
