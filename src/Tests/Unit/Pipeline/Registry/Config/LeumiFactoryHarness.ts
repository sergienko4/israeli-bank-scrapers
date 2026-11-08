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
import { buildLeumiNativePipeline } from '../../../../../Scrapers/Pipeline/Banks/Leumi/LeumiPipeline.js';
import { LEUMI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
import PIPELINE_REGISTRY from '../../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import { createPipelineBuilder } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilderFactory.js';
import type { PipelineFactory } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { WK_URLS, type WKUrlGroup } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import createScraper from '../../../../../Scrapers/Registry/Factory.js';
import { SYNTHETIC_SDK } from './LeumiSyntheticWcf.js';

type BankConfig = IPipelineContext['config'];
type BankRegistry = Partial<Record<CompanyTypes, BankConfig>>;

interface IConfigModule {
  readonly PIPELINE_BANK_CONFIG: BankRegistry;
}

interface ISeederModule {
  readonly seedWkFromPipelineConfig: (registry: BankRegistry) => unknown;
}

interface ICandidateModule {
  readonly LEUMI_API_DIRECT_CALL: IApiDirectCallConfig;
  readonly LEUMI_HEADLESS: NonNullable<BankConfig['headless']>;
}

interface IModules {
  readonly registry: IConfigModule;
  readonly seeder: ISeederModule;
  readonly candidate: ICandidateModule;
}

interface ISnapshot {
  readonly factory: PipelineFactory;
  readonly bank: BankConfig;
  readonly urls: readonly (readonly [WKUrlGroup, Map<CompanyTypes, string>])[];
  readonly fetch: typeof globalThis.fetch;
}

interface IFactoryResult {
  readonly result: IScraperScrapingResult;
  readonly phases: readonly string[];
  readonly nativePhases: readonly string[];
}

const REGISTRY = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js';
const SEEDER = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigSeeder.js';
const CANDIDATE = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumi.js';
const HINT = CompanyTypes.Leumi;
const OPTIONS = { companyId: HINT, startDate: new Date('2026-01-01') };

/**
 * Load the existing registry and inactive candidate.
 * @returns The modules needed for the isolated fixture.
 */
async function load(): Promise<IModules> {
  const registry = (await import(REGISTRY)) as IConfigModule;
  const seeder = (await import(SEEDER)) as ISeederModule;
  const candidate = (await import(CANDIDATE)) as ICandidateModule;
  return { registry, seeder, candidate };
}

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
 * Build a headless candidate through the normal descriptor builder.
 * @param config - Synthetic login configuration.
 * @returns Factory accepted by the public registry.
 */
function makeFactory(config: IApiDirectCallConfig): PipelineFactory {
  return (options: ScraperOptions): ReturnType<PipelineFactory> =>
    createPipelineBuilder()
      .withOptions(options)
      .withHeadlessMediator()
      .withApiDirect(config, LEUMI_SHAPE)
      .build();
}

/**
 * Save all registry values that the test replaces.
 * @param modules - Loaded registry.
 * @returns Snapshot used by cleanup.
 */
function snapshot(modules: IModules): ISnapshot {
  const factory = PIPELINE_REGISTRY[HINT];
  const bank = modules.registry.PIPELINE_BANK_CONFIG[HINT];
  if (factory === undefined || bank === undefined) throw new TypeError('missing registry');
  const urls = [...WK_URLS].map(([group, banks]) => [group, new Map(banks)] as const);
  return { factory, bank, urls, fetch: globalThis.fetch };
}

/**
 * Restore the original public and WK registries.
 * @param modules - Loaded registry.
 * @param saved - Snapshot taken before replacement.
 * @returns True after cleanup.
 */
function restore(modules: IModules, saved: ISnapshot): true {
  PIPELINE_REGISTRY[HINT] = saved.factory;
  modules.registry.PIPELINE_BANK_CONFIG[HINT] = saved.bank;
  globalThis.fetch = saved.fetch;
  WK_URLS.clear();
  for (const [group, banks] of saved.urls) WK_URLS.set(group, banks);
  return true;
}

/**
 * Activate the candidate in this test process only.
 * @param modules - Loaded registry and candidate.
 * @param saved - Previous registry state.
 * @param factory - Synthetic candidate factory.
 * @returns True after seeding the test registry.
 */
function install(modules: IModules, saved: ISnapshot, factory: PipelineFactory): true {
  PIPELINE_REGISTRY[HINT] = factory;
  modules.registry.PIPELINE_BANK_CONFIG[HINT] = {
    ...saved.bank,
    authStrategyKind: 'api-direct',
    headless: modules.candidate.LEUMI_HEADLESS,
  };
  modules.seeder.seedWkFromPipelineConfig(modules.registry.PIPELINE_BANK_CONFIG);
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
  const modules = await load();
  const saved = snapshot(modules);
  const config = syntheticConfig(modules.candidate.LEUMI_API_DIRECT_CALL);
  const factory = makeFactory(config);
  try {
    install(modules, saved, factory);
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const descriptor = factory(OPTIONS);
    if (!descriptor.success) throw new TypeError(descriptor.errorMessage);
    const native = buildLeumiNativePipeline(OPTIONS);
    if (!native.success) throw new TypeError(native.errorMessage);
    const result = await createScraper(OPTIONS).scrape(creds);
    const phases = descriptor.value.phases.map(phase => phase.name);
    const nativePhases = native.value.phases.map(phase => phase.name);
    return { result, phases, nativePhases };
  } finally {
    restore(modules, saved);
  }
}

export type { IFactoryResult };
export { runPublicFactory };
