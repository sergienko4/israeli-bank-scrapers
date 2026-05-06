/**
 * Pipeline builder validation — field validation and state snapshot.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { Brand } from '../../Types/Brand.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IBuilderState, LoginFn } from './PipelineAssembly.js';

/** Per-check error flag — branded so Rule #15 accepts the inline predicate. */
type IsErrCheck = Brand<boolean, 'BuilderIsErrCheck'>;

/** Scrape function signature — receives sealed action context. */
type ScrapeFn = (ctx: IActionContext) => Promise<Procedure<IPipelineContext>>;

/** Bundled raw builder fields for validation and snapshot. */
interface IBuilderFields {
  readonly options: ScraperOptions | false;
  readonly hasBrowser: boolean;
  readonly isHeadless: boolean;
  readonly loginMode: string;
  readonly error: string;
  readonly loginConfig: ILoginConfig | false;
  readonly loginFn: LoginFn | false;
  readonly hasPreLogin: boolean;
  readonly hasOtpFill: boolean;
  readonly otpFillRequired: boolean;
  readonly hasOtpTrigger: boolean;
  readonly scrapeFn: ScrapeFn | false;
  readonly apiDirectConfig: IApiDirectCallConfig | false;
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
  const failed = checks.find(([isErr]): IsErrCheck => isErr as IsErrCheck);
  if (failed) return fail(ScraperErrorTypes.Generic, failed[1]);
  return succeed(true);
}

/**
 * Snapshot builder fields into IBuilderState.
 * @param fields - Raw builder fields.
 * @returns Builder state snapshot.
 */
function toBuilderState(fields: IBuilderFields): IBuilderState {
  return { ...fields };
}

export type { IBuilderFields, ScrapeFn };
export { assertRequiredFields, toBuilderState };
