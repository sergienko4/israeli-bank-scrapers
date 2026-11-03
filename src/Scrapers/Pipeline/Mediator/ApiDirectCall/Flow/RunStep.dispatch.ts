/**
 * Dispatch + response folding — fireStep, log helpers, extract +
 * merge carry, and the top-level `runStep` entrypoint.
 */

import { getDebug } from '../../../Logging/Debug.js';
import { redactErrorMessage } from '../../../Types/PiiRedactor.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { extractFields } from '../Envelope/GenericEnvelopeParser.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { sanitiseStepFailure } from './RunStep.failure.js';
import { fireStep } from './RunStep.fire.js';
import { extractOptional } from './RunStep.optional.js';
import { judgeStepOutcome } from './RunStep.outcome.js';
import { buildDispatchBundle, mergeScopeCarry } from './RunStep.prepare.js';
import type { IDispatchBundle, IRespDescriptor, IRunStepArgs, JsonValue } from './RunStep.types.js';
import { resolvePathAndQuery } from './RunStep.url.js';

const LOG = getDebug(import.meta.url);

/**
 * Read top-level keys from a JsonValue, returning [] for non-objects.
 * @param value - Any JSON value.
 * @returns Top-level keys (empty for non-objects).
 */
function topLevelKeys(value: JsonValue): readonly string[] {
  if (typeof value !== 'object' || value === null) return [];
  if (Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * Read the bank's `error_code` envelope field when present.
 * @param resp - Parsed response JSON.
 * @returns The error_code value when found, '' otherwise.
 */
function readEnvelopeErrorCode(resp: JsonValue): string {
  if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) return '';
  const code = (resp as Record<string, JsonValue>).error_code;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  return '';
}

/**
 * Build the safe response-shape diagnostic.
 * @param resp - Response JSON value.
 * @returns Top-level keys + length + error_code value.
 */
function describeResponse(resp: JsonValue): IRespDescriptor {
  return {
    respKeys: topLevelKeys(resp),
    respLength: JSON.stringify(resp).length,
    errorCode: readEnvelopeErrorCode(resp),
  };
}

/**
 * Judge the step's outcome, then fold the response carry into the prepared
 * scope. A refused outcome fails before any extract runs. Optional extracts
 * are read after the required ones.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with the merged scope.
 */
function extractAndMerge(bundle: IDispatchBundle, resp: JsonValue): Procedure<ITemplateScope> {
  const step = bundle.fireScope.step;
  const judged = judgeStepOutcome(step, resp);
  if (!isOk(judged)) return judged;
  const carryProc = extractFields(resp, step.extractsToCarry);
  if (!isOk(carryProc)) return carryProc;
  const optional = extractOptional(resp, step);
  const merged = mergeScopeCarry(bundle.preparedScope, { ...carryProc.value, ...optional });
  return succeed(merged);
}

/**
 * Log a fire-step failure (PII-safe): the bank may quote request secrets back
 * in its error body, so only the message length is logged.
 * @param bundle - Dispatch bundle.
 * @param errorMessage - Error message from the failed step.
 * @returns Sentinel true.
 */
function logFireFail(bundle: IDispatchBundle, errorMessage: string): true {
  const errCtx = { ...bundle.baseCtx, errorMessage: redactErrorMessage(errorMessage) };
  LOG.debug({ ...errCtx, message: 'fireStep FAIL' });
  return true;
}

/**
 * Log a successful fire-step outcome (PII-safe).
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Sentinel true.
 */
function logFireOk(bundle: IDispatchBundle, resp: JsonValue): true {
  const okCtx = { ...bundle.baseCtx, ...describeResponse(resp) };
  LOG.debug({ ...okCtx, message: '[runStep] fireStep OK' });
  return true;
}

/**
 * Dispatch the prepared call and fold the extracted carry into scope. A
 * transport failure is returned under a safe `<step> HTTP <status>` message.
 * @param bundle - Dispatch bundle from `buildDispatchBundle`.
 * @returns Procedure with the merged scope, or fail.
 */
async function fireAndMergeScope(bundle: IDispatchBundle): Promise<Procedure<ITemplateScope>> {
  const respProc = await fireStep(bundle.fireScope, bundle.fireArgs);
  if (!isOk(respProc)) {
    logFireFail(bundle, respProc.errorMessage);
    return sanitiseStepFailure(bundle.fireScope.step.name, respProc);
  }
  logFireOk(bundle, respProc.value);
  return extractAndMerge(bundle, respProc.value);
}

/**
 * Run a single IStepConfig end-to-end — body hydration + optional
 * AES body-pointer signing + optional cryptoField encryption +
 * dispatch + response extraction.
 * @param args - Run-step args (step config + bus + scope + companyId).
 * @returns Procedure with the extended scope (carry merged), or fail.
 */
async function runStep(args: IRunStepArgs): Promise<Procedure<ITemplateScope>> {
  const resolved = resolvePathAndQuery(args);
  if (!isOk(resolved)) return resolved;
  const { pathAndQuery, query } = resolved.value;
  const bundleProc = buildDispatchBundle({ args, pathAndQuery, query });
  if (!isOk(bundleProc)) return bundleProc;
  return fireAndMergeScope(bundleProc.value);
}

export default runStep;

export { runStep };
