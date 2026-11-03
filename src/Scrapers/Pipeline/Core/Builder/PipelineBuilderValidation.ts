/**
 * Pipeline builder validation — field validation and state snapshot.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IApiDirectScrapeShape } from '../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { resolvePipelineBankConfig } from '../../Registry/Config/PipelineBankConfig.js';
import type { IHeadlessUrlsConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';
import type { Brand } from '../../Types/Brand.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { validateApiDirectConfig } from './ApiDirectConfigRules.js';
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
  readonly apiDirectScrape: IApiDirectScrapeShape<unknown, unknown> | false;
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
 * The bank's headless block, when the bank declares one.
 * @param options - Scraper options naming the bank.
 * @returns Headless block, or false.
 */
function headlessOf(options: ScraperOptions): IHeadlessUrlsConfig | false {
  const bank = resolvePipelineBankConfig(options.companyId);
  if (bank === false) return false;
  return bank.headless ?? false;
}

/**
 * Check an api-direct call config against its bank's headless block.
 * @param fields - Raw builder fields.
 * @param options - Scraper options naming the bank.
 * @returns Success, or the first broken config rule.
 */
function checkApiDirectFields(fields: IBuilderFields, options: ScraperOptions): Procedure<true> {
  if (fields.apiDirectConfig === false) return succeed(true);
  const headless = headlessOf(options);
  return validateApiDirectConfig({ call: fields.apiDirectConfig, headless });
}

/**
 * Validate the required fields, then the api-direct config rules.
 * @param fields - Raw builder fields.
 * @param options - Scraper options naming the bank.
 * @returns Success or the first failure.
 */
function validateBuilderFields(fields: IBuilderFields, options: ScraperOptions): Procedure<true> {
  const required = assertRequiredFields(fields);
  if (!required.success) return required;
  return checkApiDirectFields(fields, options);
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
export { assertRequiredFields, toBuilderState, validateBuilderFields };
