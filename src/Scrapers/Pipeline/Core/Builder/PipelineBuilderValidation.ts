/**
 * Pipeline builder validation — field validation and state snapshot.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IApiDirectScrapeShape } from '../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { resolvePipelineBankConfig } from '../../Registry/Config/PipelineBankConfig.js';
import type { ITransportConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';
import type { Brand } from '../../Types/Brand.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IBuilderState } from './PipelineAssembly.js';
import { NATIVE_TRANSPORT_FIELDS } from './Transport/ApiDirectNativeRules.js';
import { validateApiDirectConfig } from './Validation/ApiDirectConfigRules.js';

/** Per-check error flag — branded so Rule #15 accepts the inline predicate. */
type IsErrCheck = Brand<boolean, 'BuilderIsErrCheck'>;

/** Bundled raw builder fields for validation and snapshot. */
interface IBuilderFields {
  readonly options: ScraperOptions | false;
  readonly loginMode: string;
  readonly error: string;
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
 * The bank's transport block, when the bank declares one.
 * @param options - Scraper options naming the bank.
 * @returns Transport block, or false.
 */
function transportOf(options: ScraperOptions): ITransportConfig | false {
  const bank = resolvePipelineBankConfig(options.companyId);
  if (bank === false) return false;
  return bank.transport ?? false;
}

/**
 * Whether the bank's transport block selects the node:https transport. Its
 * mTLS strategies share the native readers and session jar, but ignore the
 * bank-wide redirect, status and failure-text defaults. Refuse those defaults
 * here even when the bank has no api-direct config.
 * @param transport - The bank's transport block.
 * @returns True when the block needs a client certificate or TLS profile.
 */
function isNodeTls(transport: ITransportConfig | false): transport is ITransportConfig {
  if (transport === false) return false;
  const hasStaticTls = transport.requiresClientCert === true || transport.tlsProfile !== undefined;
  return hasStaticTls || transport.clientCert !== undefined;
}

/**
 * Refuse a native-only transport field on a node:https block, where no
 * transport would apply it.
 * @param transport - The bank's transport block.
 * @returns Success, or a Generic failure naming the ignored field.
 */
function checkNodeTlsFields(transport: ITransportConfig | false): Procedure<true> {
  if (!isNodeTls(transport)) return succeed(true);
  const field = NATIVE_TRANSPORT_FIELDS.find((name): boolean => transport[name] !== undefined);
  if (field === undefined) return succeed(true);
  const message = `transport.${field}: not allowed without transport.nativeFetch`;
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Check an api-direct call config against its bank's transport block.
 * @param fields - Raw builder fields.
 * @param transport - The bank's transport block.
 * @returns Success, or the first broken config rule.
 */
function checkApiDirectFields(
  fields: IBuilderFields,
  transport: ITransportConfig | false,
): Procedure<true> {
  if (fields.apiDirectConfig === false) return succeed(true);
  return validateApiDirectConfig({ call: fields.apiDirectConfig, transport });
}

/**
 * Validate the required fields, then the transport and api-direct config rules.
 * @param fields - Raw builder fields.
 * @param options - Scraper options naming the bank.
 * @returns Success or the first failure.
 */
function validateBuilderFields(fields: IBuilderFields, options: ScraperOptions): Procedure<true> {
  const required = assertRequiredFields(fields);
  if (!required.success) return required;
  const transport = transportOf(options);
  const nodeTls = checkNodeTlsFields(transport);
  if (!nodeTls.success) return nodeTls;
  return checkApiDirectFields(fields, transport);
}

/**
 * Snapshot builder fields into IBuilderState.
 * @param fields - Raw builder fields.
 * @returns Builder state snapshot.
 */
function toBuilderState(fields: IBuilderFields): IBuilderState {
  return { ...fields };
}

export type { IBuilderFields };
export { assertRequiredFields, toBuilderState, validateBuilderFields };
