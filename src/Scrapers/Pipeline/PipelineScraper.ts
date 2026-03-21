/**
 * PipelineScraper — IScraper adapter that delegates to executePipeline.
 * Stub: delegates to executePipeline (itself a stub) until Step 2.
 */

import { EventEmitter } from 'node:events';

import type { CompanyTypes, ScraperProgressTypes } from '../../Definitions.js';
import type {
  IScraper,
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperGetLongTermTwoFactorTokenResult,
  ScraperOptions,
  ScraperTwoFactorAuthTriggerResult,
} from '../Base/Interface.js';
import type { VoidResult } from '../Base/Interfaces/CallbackTypes.js';
import ScraperError from '../Base/ScraperError.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';
import { executePipeline } from './PipelineExecutor.js';
import { isOk, type Procedure, toLegacy } from './Types/Procedure.js';

/** Pipeline builder function type — returns Procedure for validation safety. */
type PipelineBuildFn = (options: ScraperOptions) => Procedure<IPipelineDescriptor>;

/** Progress callback — matches IScraper.onProgress signature. */
type ProgressCallback = (
  companyId: CompanyTypes,
  payload: { type: ScraperProgressTypes },
) => VoidResult;

/** Event name for scrape progress notifications. */
const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

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
  public scrape(credentials: TCredentials): Promise<IScraperScrapingResult> {
    const buildResult = this._buildPipeline(this._options);
    if (!isOk(buildResult)) {
      const legacy = toLegacy(buildResult);
      return Promise.resolve(legacy);
    }
    return executePipeline(buildResult.value, credentials);
  }

  /**
   * Register a listener for scrape progress events.
   * @param func - Callback receiving company ID and progress payload.
   * @returns True after registration.
   */
  public onProgress(func: ProgressCallback): VoidResult {
    this._emitter.on(SCRAPE_PROGRESS, func);
  }

  /**
   * Trigger two-factor authentication (stub — override per bank).
   * @param phoneNumber - The phone number to send OTP to.
   * @returns Trigger result.
   */
  public triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    const bank = this._options.companyId;
    const masked = `***${phoneNumber.slice(-4)}`;
    const error = new ScraperError(`triggerOtp(${masked}) not implemented for ${bank}`);
    return Promise.reject(error);
  }

  /**
   * Retrieve long-term OTP token (stub — override per bank).
   * @param otpCode - The one-time password.
   * @returns Long-term token result.
   */
  public getLongTermTwoFactorToken(
    otpCode: string,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    const bank = this._options.companyId;
    const codeLength = String(otpCode.length);
    const msg = `getPermanentOtpToken(${codeLength} chars) not implemented for ${bank}`;
    const error = new ScraperError(msg);
    return Promise.reject(error);
  }
}

export type { PipelineBuildFn };
export { PipelineScraper };
