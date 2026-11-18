/**
 * PipelineScraper — IScraper adapter that builds a bank's pipeline from the
 * scraper options, runs it with executePipeline and returns the legacy result.
 */

import { EventEmitter } from 'node:events';

import type { CompanyTypes, ScraperProgressTypes } from '../../../Definitions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type {
  IScraper,
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from '../../Base/Interface.js';
import type { VoidResult } from '../../Base/Interfaces/CallbackTypes.js';
import { fail, isOk, type Procedure, succeed, toLegacy } from '../Types/Procedure.js';
import validateBoundary from './BoundaryValidation.js';
import normalizeCredentials from './CredentialAliases.js';
import executePipeline from './Executor/PipelineExecutor.js';
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
 * Snapshot caller options, copying the Date and reading the signal explicitly
 * so later mutations and prototype getters cannot change the validated run.
 * @param options - Caller options.
 * @returns A shallow copy with a local startDate when it is readable.
 */
function snapshotOptions(options: ScraperOptions): ScraperOptions {
  const signal = options.signal;
  try {
    const time = Date.prototype.getTime.call(options.startDate);
    return { ...options, startDate: new Date(time), signal };
  } catch {
    return { ...options, signal };
  }
}

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
    const options = snapshotOptions(this._options);
    const buildResult = this._buildPipeline(options);
    if (!isOk(buildResult)) return toLegacy(buildResult);
    return runDescriptor(buildResult.value, credentials);
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

/**
 * Refuse a non-object credential bag before normalization.
 * @param credentials - Raw caller credentials.
 * @returns The typed failure, or false when it is an object.
 */
function refuseNonObject(credentials: unknown): IScraperScrapingResult | false {
  if (credentials !== null && typeof credentials === 'object') return false;
  const failure = fail(ScraperErrorTypes.Generic, 'credentials must be an object');
  return toLegacy(failure);
}

/**
 * Validate the public boundary, then enrich and run the descriptor.
 * @param descriptor - Built pipeline descriptor.
 * @param credentials - User bank credentials.
 * @returns Legacy scrape result.
 */
/**
 * Normalize aliases, then validate the boundary.
 * @param descriptor - Built pipeline descriptor.
 * @param credentials - User bank credentials.
 * @returns The normalized credentials, or the boundary failure.
 */
function normalizedWithBoundary(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Procedure<ScraperCredentials> {
  const normalized = normalizeCredentials(credentials);
  const boundary = validateBoundary(descriptor.options, normalized, descriptor.credentialPolicy);
  if (!isOk(boundary)) return boundary;
  return succeed(normalized);
}

/**
 * Validate the public boundary, then enrich and run the descriptor.
 * @param descriptor - Built pipeline descriptor.
 * @param credentials - User bank credentials.
 * @returns Legacy scrape result.
 */
async function runDescriptor(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const refused = refuseNonObject(credentials);
  if (refused !== false) return refused;
  const ready = normalizedWithBoundary(descriptor, credentials);
  if (!isOk(ready)) return toLegacy(ready);
  return runEnriched(descriptor, ready.value);
}

export default PipelineScraper;
