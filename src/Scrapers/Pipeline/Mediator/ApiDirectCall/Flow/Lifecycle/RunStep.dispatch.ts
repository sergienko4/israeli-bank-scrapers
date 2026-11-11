/**
 * Dispatch + response folding — fireStep, log helpers, extract +
 * merge carry, and the top-level `runStep` entrypoint.
 */

import { getDebug } from '../../../../Logging/Debug.js';
import { redactErrorMessage } from '../../../../Types/PiiRedactor.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { isOk, succeed } from '../../../../Types/Procedure.js';
import { extractFields } from '../../Envelope/GenericEnvelopeParser.js';
import type { ITemplateScope } from '../../Template/RefResolver.js';
import { openGuardedAnswer } from '../Signing/RunStep.codec.js';
import { answerSlots } from '../Steps/RunStep.answerSlots.js';
import { deriveStepCarry } from '../Steps/RunStep.derive.js';
import { ruleStepCarry } from '../Steps/RunStep.extractRules.js';
import { sanitiseStepFailure } from '../Steps/RunStep.failure.js';
import { fireStep } from '../Steps/RunStep.fire.js';
import { judgeAnswer } from '../Steps/RunStep.judge.js';
import { extractOptional } from '../Steps/RunStep.optional.js';
import { buildDispatchBundle, mergeScopeCarry } from '../Steps/RunStep.prepare.js';
import { prepareStepSession } from '../Steps/RunStep.session.js';
import type {
  CarryMap,
  IDispatchBundle,
  IRespDescriptor,
  IRunStepArgs,
  JsonValue,
} from '../Steps/RunStep.types.js';
import { resolvePathAndQuery } from '../Steps/RunStep.url.js';

const LOG = getDebug(import.meta.url);

/**
 * Count top-level keys without exposing bank-controlled field names.
 * @param value - Any JSON value.
 * @returns Top-level key count (zero for non-objects).
 */
function responseKeyCount(value: JsonValue): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0;
  return Object.keys(value).length;
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
 * Describe the response shape under the bank-text omission policy.
 * @param resp - Response JSON value.
 * @param isBankTextOmitted - Whether response values need length-only hints.
 * @returns Key count, length and a policy-safe error-code hint.
 */
function describeResponse(resp: JsonValue, isBankTextOmitted: boolean): IRespDescriptor {
  const errorCode = readEnvelopeErrorCode(resp);
  return {
    respKeyCount: responseKeyCount(resp),
    respLength: JSON.stringify(resp).length,
    errorCode: isBankTextOmitted ? redactErrorMessage(errorCode) : errorCode,
  };
}

/**
 * Read a step's carry from its answer: the required extracts, then the
 * response-header slots and text captures, then the optional extracts.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with the step's carry, or the first missing field.
 */
function readCarry(bundle: IDispatchBundle, resp: JsonValue): Procedure<CarryMap> {
  const step = bundle.fireScope.step;
  const isBankTextOmitted = bundle.fireScope.isBankTextOmitted === true;
  const carryProc = extractFields(resp, step.extractsToCarry, isBankTextOmitted);
  if (!isOk(carryProc)) return carryProc;
  const answerProc = answerSlots(bundle, resp);
  if (!isOk(answerProc)) return answerProc;
  const optional = extractOptional(resp, step, bundle.preparedScope.carry);
  return succeed({ ...carryProc.value, ...optional, ...answerProc.value });
}

/**
 * Read a step's carry from its answer, then check its ruled slots.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with the step's carry, or the first missing or refused field.
 */
function collectCarry(bundle: IDispatchBundle, resp: JsonValue): Procedure<CarryMap> {
  const carry = readCarry(bundle, resp);
  if (!isOk(carry)) return carry;
  return ruleStepCarry(bundle, resp, carry.value);
}

/**
 * Judge the step's outcome, classify its answer, fold the response carry
 * into the prepared scope, then derive the step's own slots. A refused outcome
 * or an unclassified answer fails before any extract.
 * @param bundle - Dispatch bundle.
 * @param resp - Opened, guarded response JSON.
 * @returns Procedure with the merged scope.
 */
function extractAndMerge(bundle: IDispatchBundle, resp: JsonValue): Procedure<ITemplateScope> {
  const step = bundle.fireScope.step;
  const classified = judgeAnswer(step, resp);
  if (!isOk(classified)) return classified;
  const carry = collectCarry(bundle, resp);
  if (!isOk(carry)) return carry;
  const merged = mergeScopeCarry(bundle.preparedScope, { ...carry.value, ...classified.value });
  return deriveStepCarry(step, merged);
}

/**
 * Open a codec step's answer and guard it against bank errors,
 * then judge and extract from it. A bank error fails before the outcome.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with the merged scope.
 */
function openAndMerge(bundle: IDispatchBundle, resp: JsonValue): Procedure<ITemplateScope> {
  const opened = openGuardedAnswer(bundle, resp);
  if (!isOk(opened)) return opened;
  return extractAndMerge(opened.value.bundle, opened.value.answer);
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
 * Log a successful fire-step outcome under its bank-text omission policy.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Sentinel true.
 */
function logFireOk(bundle: IDispatchBundle, resp: JsonValue): true {
  const isBankTextOmitted = bundle.fireScope.isBankTextOmitted === true;
  const descriptor = describeResponse(resp, isBankTextOmitted);
  const okCtx = { ...bundle.baseCtx, ...descriptor };
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
  const respProc = await fireStep(bundle.fireScope, bundle.fireArgs, bundle.target);
  if (!isOk(respProc)) {
    logFireFail(bundle, respProc.errorMessage);
    return sanitiseStepFailure(bundle.fireScope.step, respProc);
  }
  logFireOk(bundle, respProc.value);
  return openAndMerge(bundle, respProc.value);
}

/**
 * Run a single IStepConfig end-to-end — client cookies + device
 * certificate + body hydration + optional AES body-pointer signing +
 * optional cryptoField encryption + dispatch + response extraction.
 * @param args - Run-step args (step config + bus + scope + companyId).
 * @returns Procedure with the extended scope (carry merged), or fail.
 */
async function runStep(args: IRunStepArgs): Promise<Procedure<ITemplateScope>> {
  const bound = prepareStepSession(args);
  if (!isOk(bound)) return bound;
  const resolved = resolvePathAndQuery(bound.value);
  if (!isOk(resolved)) return resolved;
  const { pathAndQuery, query, target } = resolved.value;
  const bundleProc = buildDispatchBundle({ args: bound.value, pathAndQuery, query, target });
  if (!isOk(bundleProc)) return bundleProc;
  return fireAndMergeScope(bundleProc.value);
}

export default runStep;

export { runStep };
