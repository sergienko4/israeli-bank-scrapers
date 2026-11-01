/**
 * Step envelope codec (N39, N52) — seal a POST step's prepared body after its
 * form guard, and open its answer before its bank-error guard (N20), outcome
 * or extracts read it: they then see `{ headers, data }`, the original headers
 * and the opened data. A codec step's answer must come back sealed. A plaintext answer with a
 * non-zero numeric `error_code` is a bank error and any other plaintext answer
 * an invalid envelope; opened data with such a code is a bank error too.
 * Failures name the step, never a key, IV or plaintext.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { getDebug } from '../../../Logging/Debug.js';
import type { IJsonObject, JsonValue } from '../../../Types/JsonValue.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IEnvelopeSealed } from '../ConfigContracts/index.js';
import { type IEnvelopeSession, sealEnvelope, toSession } from '../Crypto/EnvelopeCodec.js';
import { openEnvelope } from '../Crypto/EnvelopeCodec.open.js';
import { isJsonRecord } from '../Crypto/EnvelopeWire.js';
import { type ITemplateScope, resolveRefText } from '../Template/RefResolver.js';
import { bankErrorOf, guardBankError } from './RunStep.failIfPresent.js';
import { guardFormBody } from './RunStep.form.js';
import type { IDispatchBundle, IPreparedBody, IStepConfig } from './RunStep.types.js';

const LOG = getDebug(import.meta.url);

/** Failure reason when carry lacks a sound session key or id. */
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
 * The crypto session the codec's carry refs name.
 * @param codec - Sealed codec config.
 * @param scope - Step scope.
 * @returns The session, or false when the key or id is missing or malformed.
 */
function sessionOf(codec: IEnvelopeSealed, scope: ITemplateScope): IEnvelopeSession | false {
  const keyText = resolveRefText(codec.keyRef, scope);
  const id = resolveRefText(codec.sessionRef, scope);
  if (keyText === false || id === false) return false;
  return toSession(keyText, id);
}

/**
 * Seal the prepared body when the step names a codec.
 * @param step - Step config.
 * @param prepared - Prepared body and scope.
 * @returns The sealed body, or `<step> envelope …` failure.
 */
function sealStepBody(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  const codec = step.codec;
  if (codec === undefined) return succeed(prepared);
  const session = sessionOf(codec, prepared.scope);
  if (session === false) return stepFail(step, KEY_INVALID);
  const sealed = sealEnvelope(session, prepared.body as JsonValue);
  if (!isOk(sealed)) return stepFail(step, sealed.errorMessage);
  return succeed({ body: sealed.value, scope: prepared.scope });
}

/**
 * Guard a form body, then seal the envelope when the step names a codec.
 * @param step - Step config.
 * @param prepared - Signed body and scope.
 * @returns The body ready to send, or the first failure.
 */
function sealGuardedBody(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  const guarded = guardFormBody(step, prepared);
  if (!isOk(guarded)) return guarded;
  return sealStepBody(step, guarded.value);
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
 * Log the opened data's top-level keys (never its values).
 * @param bundle - Dispatch bundle.
 * @param data - Opened data.
 * @returns Sentinel true.
 */
function logOpened(bundle: IDispatchBundle, data: JsonValue): true {
  const dataKeys = isJsonRecord(data) ? Object.keys(data) : [];
  LOG.debug({ ...bundle.baseCtx, dataKeys, message: '[runStep] envelope opened' });
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

/**
 * Open a sealed-mode answer under the carried session.
 * @param bundle - Dispatch bundle.
 * @param codec - Sealed codec config.
 * @param resp - Parsed answer.
 * @returns The opened answer, or a step failure.
 */
function openSealedAnswer(
  bundle: IDispatchBundle,
  codec: IEnvelopeSealed,
  resp: JsonValue,
): Procedure<IOpenedAnswer> {
  const session = sessionOf(codec, bundle.preparedScope);
  if (session === false) return stepFail(bundle.fireScope.step, KEY_INVALID);
  return openForStep(bundle, session, resp);
}

/**
 * Open a codec step's answer; any other step's answer passes as it came.
 * @param bundle - Dispatch bundle.
 * @param resp - Parsed answer.
 * @returns The answer the step's guards and extracts read, or a step failure.
 */
function openStepAnswer(bundle: IDispatchBundle, resp: JsonValue): Procedure<IOpenedAnswer> {
  const codec = bundle.fireScope.step.codec;
  if (codec === undefined) return succeed({ bundle, answer: resp });
  if (hasBankErrorCode(resp)) return bankErrorOf(bundle.fireScope.step);
  return openSealedAnswer(bundle, codec, resp);
}

/**
 * Open a codec step's answer, then guard it against bank errors (N20): the
 * guard pointers read the opened view.
 * @param bundle - Dispatch bundle.
 * @param resp - Parsed answer.
 * @returns The answer the step's outcome and extracts read, or a step failure.
 */
function openGuardedAnswer(bundle: IDispatchBundle, resp: JsonValue): Procedure<IOpenedAnswer> {
  const opened = openStepAnswer(bundle, resp);
  if (!isOk(opened)) return opened;
  const guarded = guardBankError(bundle.fireScope.step, opened.value.answer);
  if (!isOk(guarded)) return guarded;
  return opened;
}

export { openGuardedAnswer, sealGuardedBody };
