/**
 * Exchange codec mode (N39): the key-exchange step's body goes out as
 * hydrated, once its carried client scalar is sound. Its answer's
 * `key_exchange` header and that scalar make the crypto session; the answer
 * must open under it (N52), and the session key (base64) and id then go to
 * the `keyInto` and `sessionInto` carry slots for the sealed steps after it.
 */

import type { ECDH } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { JsonValue } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IEnvelopeExchange } from '../ConfigContracts/index.js';
import { exchangeSession, toExchangeKey } from '../Crypto/EnvelopeCodec.exchange.js';
import type { IEnvelopeSession } from '../Crypto/EnvelopeCodec.js';
import { type ITemplateScope, resolveRefText } from '../Template/RefResolver.js';
import { type IOpenedAnswer, KEY_INVALID, openForStep, stepFail } from './RunStep.codec.open.js';
import type { CarryMap, IDispatchBundle, IPreparedBody } from './RunStep.types.js';

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
  if (ecdh === false) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  return succeed(prepared);
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
  return exchangeSession(ecdh, resp);
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
