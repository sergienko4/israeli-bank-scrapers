/**
 * Pipeline builder validation — field validation and state snapshot.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import type { OtpConfig } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import type { IScrapeConfigBase } from '../Types/ScrapeConfig.js';
import type { IBuilderState, LoginFn } from './BuilderAssembly.js';

type IsErrCheck = boolean;
/** Whether a builder capability flag is set. */
type HasCapability = boolean;
/** Builder login mode name. */
type LoginModeName = string;
/** Builder error message (empty when no error). */
type BuilderError = string;

/** Scrape function signature. */
type ScrapeFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/** Bundled raw builder fields for validation and snapshot. */
interface IBuilderFields {
  readonly options: ScraperOptions | false;
  readonly hasBrowser: HasCapability;
  readonly loginMode: LoginModeName;
  readonly error: BuilderError;
  readonly loginConfig: ILoginConfig | false;
  readonly loginFn: LoginFn | false;
  readonly otpConfig: OtpConfig | false;
  readonly hasOtp: HasCapability;
  readonly scrapeFn: ScrapeFn | false;
  readonly scrapeConfig: IScrapeConfigBase | false;
}

/**
 * Validate required builder fields.
 * @param fields - Raw builder fields.
 * @returns Success or failure.
 */
function assertRequiredFields(fields: IBuilderFields): Procedure<true> {
  const checks: readonly [boolean, string][] = [
    [!!fields.error, fields.error || ''],
    [fields.options === false, 'PipelineBuilder: withOptions() is required'],
    [fields.loginMode === 'none', 'PipelineBuilder: a login mode is required'],
  ];
  const failed = checks.find(([isErr]): IsErrCheck => isErr);
  if (failed) return fail(ScraperErrorTypes.Generic, failed[1]);
  return succeed(true);
}

/**
 * Snapshot builder fields into IBuilderState.
 * @param fields - Raw builder fields.
 * @returns Builder state snapshot.
 */
function toBuilderState(fields: IBuilderFields): IBuilderState {
  return {
    hasBrowser: fields.hasBrowser,
    hasOtp: fields.hasOtp,
    loginMode: fields.loginMode,
    loginConfig: fields.loginConfig,
    loginFn: fields.loginFn,
    otpConfig: fields.otpConfig,
    scrapeFn: fields.scrapeFn,
    scrapeConfig: fields.scrapeConfig,
  };
}

export type { IBuilderFields, ScrapeFn };
export { assertRequiredFields, toBuilderState };
