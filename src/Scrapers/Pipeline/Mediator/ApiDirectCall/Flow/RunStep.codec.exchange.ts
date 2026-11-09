/**
 * Exchange codec mode: the key-exchange step's body goes out as
 * hydrated, once its carried client scalar is sound. Its answer's
 * `key_exchange` header and that scalar make the crypto session; the answer
 * must open under it, and the session key (base64) and id then go to
 * the `keyInto` and `sessionInto` carry slots for the sealed steps after it.
 */

import type { ECDH } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { JsonUnknown, JsonUnknownRecord, JsonValue } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IEnvelopeExchange } from '../ConfigContracts/index.js';
import { exchangeSession, toExchangeKey } from '../Crypto/EnvelopeCodec.exchange.js';
import type { IEnvelopeSession } from '../Crypto/EnvelopeCodec.js';
import { type ITemplateScope, resolveRefText } from '../Template/RefResolver.js';
import { type IOpenedAnswer, KEY_INVALID, openForStep, stepFail } from './RunStep.codec.open.js';
import type { CarryMap, IDispatchBundle, IPreparedBody } from './RunStep.types.js';

const ENVELOPE_INVALID = 'envelope invalid';

/** A request or answer field that must match the configured public point. */
interface IExchangeBinding {
  readonly value: JsonUnknown;
  readonly field: 'y' | 'echo_y';
}

/**
 * Identifies a record at the request or response boundary.
 * @param value - Boundary value.
 * @returns True when the value is a record.
 */
function isRecord(value: JsonUnknown): value is JsonUnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Identifies a key-exchange header.
 * @param value - Candidate header.
 * @returns True when the record names a key exchange.
 */
function isExchangeHeader(value: JsonUnknown): value is JsonUnknownRecord {
  return isRecord(value) && value.type === 'key_exchange';
}

/**
 * Selects exactly one exchange header without copying the header list.
 * @param headers - Request or answer headers.
 * @returns The unique header, or false.
 */
function uniqueExchangeHeader(headers: readonly JsonUnknown[]): JsonUnknownRecord | false {
  const index = headers.findIndex(isExchangeHeader);
  const header = headers[index];
  if (!isExchangeHeader(header)) return false;
  if (headers.some((entry, pos): boolean => pos > index && isExchangeHeader(entry))) return false;
  return header;
}

/**
 * Checks a field on the only exchange header without exposing its value.
 * @param value - Request or answer.
 * @param field - Exchange header field.
 * @param expected - Configured public point.
 * @returns True when exactly one exchange header matches.
 */
function matchesExchangeField(
  value: JsonUnknown,
  field: IExchangeBinding['field'],
  expected: string,
): boolean {
  if (!isRecord(value) || !Array.isArray(value.headers)) return false;
  const header = uniqueExchangeHeader(value.headers);
  return header !== false && header[field] === expected;
}

/**
 * Applies the optional public-point binding to an exchange.
 * @param codec - Exchange codec config.
 * @param scope - Step scope.
 * @param binding - Request or answer field to check.
 * @returns True when binding is absent or matches.
 */
function hasBoundExchange(
  codec: IEnvelopeExchange,
  scope: ITemplateScope,
  binding: IExchangeBinding,
): boolean {
  if (codec.echoRef === undefined) return true;
  const expected = resolveRefText(codec.echoRef, scope);
  if (expected === false || expected.length === 0) return false;
  return matchesExchangeField(binding.value, binding.field, expected);
}

/**
 * The client key pair the codec's carry ref names.
 * @param codec - Exchange codec config.
 * @param scope - Step scope.
 * @returns The key pair, or false when the scalar is missing or malformed.
 */
function exchangeKeyOf(codec: IEnvelopeExchange, scope: ITemplateScope): ECDH | false {
  const privateText = resolveRefText(codec.privateRef, scope);
  if (privateText === false) return false;
  return toExchangeKey(privateText);
}

/**
 * Pass the body on as hydrated once the client scalar is sound.
 * @param codec - Exchange codec config.
 * @param prepared - Guarded body and scope.
 * @returns The body as it is, or `envelope key invalid`.
 */
function checkExchangeKey(
  codec: IEnvelopeExchange,
  prepared: IPreparedBody,
): Procedure<IPreparedBody> {
  const ecdh = exchangeKeyOf(codec, prepared.scope);
  const binding: IExchangeBinding = { value: prepared.body, field: 'y' };
  const isValid = ecdh !== false && hasBoundExchange(codec, prepared.scope, binding);
  return isValid ? succeed(prepared) : fail(ScraperErrorTypes.Generic, KEY_INVALID);
}

/**
 * The crypto session the answer and the carried scalar make.
 * @param codec - Exchange codec config.
 * @param scope - Step scope.
 * @param resp - Parsed answer.
 * @returns The session, or `envelope key invalid` / `envelope invalid`.
 */
function sessionFor(
  codec: IEnvelopeExchange,
  scope: ITemplateScope,
  resp: JsonValue,
): Procedure<IEnvelopeSession> {
  const ecdh = exchangeKeyOf(codec, scope);
  if (ecdh === false) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  const isBound = hasBoundExchange(codec, scope, { value: resp, field: 'echo_y' });
  return isBound ? exchangeSession(ecdh, resp) : fail(ScraperErrorTypes.Generic, ENVELOPE_INVALID);
}

/**
 * The bundle with the session key (base64) and id in their carry slots.
 * @param bundle - Dispatch bundle.
 * @param codec - Exchange codec config.
 * @param session - Derived session.
 * @returns The bundle whose prepared scope carries the session.
 */
function carrySession(
  bundle: IDispatchBundle,
  codec: IEnvelopeExchange,
  session: IEnvelopeSession,
): IDispatchBundle {
  const keyText = session.key.toString('base64');
  const slots: CarryMap = { [codec.keyInto]: keyText, [codec.sessionInto]: session.id };
  const carry = { ...bundle.preparedScope.carry, ...slots };
  return { ...bundle, preparedScope: { ...bundle.preparedScope, carry } };
}

/**
 * Derive the session from a key-exchange answer, then open the answer under it.
 * @param bundle - Dispatch bundle.
 * @param codec - Exchange codec config.
 * @param resp - Parsed answer.
 * @returns The opened answer whose bundle carries the session, or a step failure.
 */
function openExchangeAnswer(
  bundle: IDispatchBundle,
  codec: IEnvelopeExchange,
  resp: JsonValue,
): Procedure<IOpenedAnswer> {
  const session = sessionFor(codec, bundle.preparedScope, resp);
  if (!isOk(session)) return stepFail(bundle.fireScope.step, session.errorMessage);
  const carried = carrySession(bundle, codec, session.value);
  return openForStep(carried, session.value, resp);
}

export { checkExchangeKey, openExchangeAnswer };
