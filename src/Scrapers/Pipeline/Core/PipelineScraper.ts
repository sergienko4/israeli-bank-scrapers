/**
 * PipelineScraper — IScraper adapter that builds a bank's pipeline from the
 * scraper options, runs it with executePipeline and returns the legacy result.
 */

import { EventEmitter } from 'node:events';

import type { CompanyTypes, ScraperProgressTypes } from '../../../Definitions.js';
import type {
  IScraper,
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from '../../Base/Interface.js';
import type { VoidResult } from '../../Base/Interfaces/CallbackTypes.js';
import { isOk, type Procedure, succeed, toLegacy } from '../Types/Procedure.js';
import { normalizeCredentials } from './CredentialAliases.js';
import { executePipeline } from './Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/** Pipeline builder function type — returns Procedure for validation safety. */
type PipelineBuildFn = (options: ScraperOptions) => Procedure<IPipelineDescriptor>;

/** Progress callback — matches IScraper.onProgress signature. */
type ProgressCallback = (
  companyId: CompanyTypes,
  payload: { type: ScraperProgressTypes },
) => VoidResult;

/** Event name for scrape progress notifications. */
const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

/**
 * Let the bank fill credentials it can derive itself, when it declares a hook.
 * @param descriptor - Built pipeline descriptor.
 * @param credentials - Normalized caller credentials.
 * @returns The enriched credentials, or the hook's failure.
 */
function enrichedCredentials(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Procedure<ScraperCredentials> {
  if (descriptor.enrichCredentials === undefined) return succeed(credentials);
  return descriptor.enrichCredentials(credentials);
}

/**
 * Enrich credentials, then run the descriptor.
 * @param descriptor - Built pipeline descriptor.
 * @param credentials - Normalized caller credentials.
 * @returns Legacy scrape result.
 */
async function runEnriched(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const enriched = enrichedCredentials(descriptor, credentials);
  if (!isOk(enriched)) return toLegacy(enriched);
  return executePipeline(descriptor, enriched.value);
}

/** IScraper adapter — wraps pipeline execution for backward compatibility. */
class PipelineScraper<TCredentials extends ScraperCredentials> implements IScraper<TCredentials> {
  private readonly _emitter = new EventEmitter();

  private readonly _options: ScraperOptions;

  private readonly _buildPipeline: PipelineBuildFn;

  /**
   * Create a PipelineScraper.
   * @param options - Scraper configuration.
   * @param buildPipeline - Factory that builds the pipeline descriptor.
   */
  constructor(options: ScraperOptions, buildPipeline: PipelineBuildFn) {
    this._options = options;
    this._buildPipeline = buildPipeline;
  }

  /**
   * Run the full scrape lifecycle via pipeline.
   * @param credentials - User bank credentials.
   * @returns Legacy result shape.
   */
  public async scrape(credentials: TCredentials): Promise<IScraperScrapingResult> {
    const buildResult = this._buildPipeline(this._options);
    if (!isOk(buildResult)) {
      const legacy = toLegacy(buildResult);
      return legacy;
    }
    const normalized = normalizeCredentials(credentials);
    return runEnriched(buildResult.value, normalized);
  }

  /**
   * Register a listener for scrape progress events.
   * @param func - Callback receiving company ID and progress payload.
   * @returns True after registration.
   */
  public onProgress(func: ProgressCallback): VoidResult {
    this._emitter.on(SCRAPE_PROGRESS, func);
  }
}

export type { PipelineBuildFn };
export { PipelineScraper };
