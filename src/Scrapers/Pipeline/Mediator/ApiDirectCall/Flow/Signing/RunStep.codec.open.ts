/**
 * Step envelope opening, shared by the codec modes: open a step's
 * answer under a crypto session into its `{ headers, data }` view, and fail
 * opened data that carries a bank error code. Failures name the step, never a
 * key, IV or plaintext; only the opened data's key count is logged.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import { getDebug } from '../../../../Logging/Debug.js';
import type { IJsonObject, JsonValue } from '../../../../Types/JsonValue.js';
import type { IProcedureFailure, Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IEnvelopeSession } from '../../Crypto/EnvelopeCodec.js';
import { openEnvelope } from '../../Crypto/EnvelopeCodec.open.js';
import { isJsonRecord } from '../../Crypto/EnvelopeWire.js';
import { bankErrorOf } from '../RunStep.failIfPresent.js';
import type { IDispatchBundle, IStepConfig } from '../RunStep.types.js';

const LOG = getDebug(import.meta.url);

/** Failure reason when carry lacks a sound session key, id or client scalar. */
const KEY_INVALID = 'envelope key invalid';

/** An answer ready for the step's guards and extracts, and its bundle. */
interface IOpenedAnswer {
  readonly bundle: IDispatchBundle;
  readonly answer: JsonValue;
}

/**
 * A Generic failure naming the step and a reason.
 * @param step - Step config.
 * @param reason - Value-free reason.
 * @returns The failure.
 */
function stepFail(step: IStepConfig, reason: string): IProcedureFailure {
  return fail(ScraperErrorTypes.Generic, `${step.name} ${reason}`);
}

/**
 * Whether a value is a record with a non-zero numeric `error_code`.
 * @param value - Answer or opened data.
 * @returns True when the bank reports an error code.
 */
function hasBankErrorCode(value: JsonValue): boolean {
  if (!isJsonRecord(value)) return false;
  const code = value.error_code;
  return typeof code === 'number' && code !== 0;
}

/**
 * Log the opened data's key count, never bank-controlled field names.
 * @param bundle - Dispatch bundle.
 * @param data - Opened data.
 * @returns Sentinel true.
 */
function logOpened(bundle: IDispatchBundle, data: JsonValue): true {
  const dataKeyCount = isJsonRecord(data) ? Object.keys(data).length : 0;
  LOG.debug({ ...bundle.baseCtx, dataKeyCount, message: '[runStep] envelope opened' });
  return true;
}

/**
 * Fail opened data with a bank error code; pass any other opened answer on.
 * @param bundle - Dispatch bundle.
 * @param opened - Opened `{ headers, data }` view.
 * @returns The opened answer, or `<step> bank error`.
 */
function screenOpened(bundle: IDispatchBundle, opened: IJsonObject): Procedure<IOpenedAnswer> {
  if (hasBankErrorCode(opened.data)) return bankErrorOf(bundle.fireScope.step);
  logOpened(bundle, opened.data);
  return succeed({ bundle, answer: opened });
}

/**
 * Open an answer under a session.
 * @param bundle - Dispatch bundle.
 * @param session - Crypto session.
 * @param resp - Parsed answer.
 * @returns The opened answer, or `<step> envelope invalid` / `<step> bank error`.
 */
function openForStep(
  bundle: IDispatchBundle,
  session: IEnvelopeSession,
  resp: JsonValue,
): Procedure<IOpenedAnswer> {
  const opened = openEnvelope(session, resp);
  if (!isOk(opened)) return stepFail(bundle.fireScope.step, opened.errorMessage);
  return screenOpened(bundle, opened.value);
}

export type { IOpenedAnswer };
export { hasBankErrorCode, KEY_INVALID, openForStep, stepFail };
