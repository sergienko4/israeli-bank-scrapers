/**
 * Dispatch + response folding — firePost, log helpers, extract +
 * merge carry, and the top-level `runStep` entrypoint.
 */

import { getDebug } from '../../../Types/Debug.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { extractFields } from '../Envelope/GenericEnvelopeParser.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { buildDispatchBundle, mergeScopeCarry } from './RunStep.prepare.js';
import type {
  IDispatchBundle,
  IFireArgs,
  IRespDescriptor,
  IRunStepArgs,
  JsonValue,
} from './RunStep.types.js';
import { resolvePathAndQuery } from './RunStep.url.js';

const LOG = getDebug(import.meta.url);

/**
 * Fire the apiPost with the assembled pieces.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @returns Procedure with the parsed response JSON.
 */
async function firePost(args: IRunStepArgs, fire: IFireArgs): Promise<Procedure<JsonValue>> {
  return args.bus.apiPost<JsonValue>(args.step.urlTag, fire.body, {
    extraHeaders: fire.extraHeaders,
    query: fire.query,
    onSetCookie: fire.onSetCookie,
  });
}

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
 * Fold the response carry into the prepared scope.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with the merged scope.
 */
function extractAndMerge(bundle: IDispatchBundle, resp: JsonValue): Procedure<ITemplateScope> {
  const carryProc = extractFields(resp, bundle.fireScope.step.extractsToCarry);
  if (!isOk(carryProc)) return carryProc;
  const merged = mergeScopeCarry(bundle.preparedScope, carryProc.value);
  return succeed(merged);
}

/**
 * Log a fire-post failure (PII-safe).
 * @param bundle - Dispatch bundle.
 * @param errorMessage - Error message from the failed post.
 * @returns Sentinel true.
 */
function logFireFail(bundle: IDispatchBundle, errorMessage: string): true {
  const errCtx = { ...bundle.baseCtx, errorMessage };
  LOG.debug({ ...errCtx, message: 'firePost FAIL' });
  return true;
}

/**
 * Log a successful fire-post outcome (PII-safe).
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Sentinel true.
 */
function logFireOk(bundle: IDispatchBundle, resp: JsonValue): true {
  const okCtx = { ...bundle.baseCtx, ...describeResponse(resp) };
  LOG.debug({ ...okCtx, message: '[runStep] firePost OK' });
  return true;
}

/**
 * Dispatch the prepared call and fold the extracted carry into scope.
 * @param bundle - Dispatch bundle from `buildDispatchBundle`.
 * @returns Procedure with the merged scope, or fail.
 */
async function fireAndMergeScope(bundle: IDispatchBundle): Promise<Procedure<ITemplateScope>> {
  const respProc = await firePost(bundle.fireScope, bundle.fireArgs);
  if (!isOk(respProc)) {
    logFireFail(bundle, respProc.errorMessage);
    return respProc;
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
