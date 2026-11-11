/**
 * Sealed codec mode: the step's `{ headers, data }` body goes out sealed
 * under the session key and id carried by earlier steps, and its answer opens
 * under the same session. A missing or malformed key or id fails before the
 * request is sent.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { JsonValue } from '../../../../Types/JsonValue.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IEnvelopeSealed } from '../../ConfigContracts/index.js';
import { type IEnvelopeSession, sealEnvelope, toSession } from '../../Crypto/EnvelopeCodec.js';
import { type ITemplateScope, resolveRefText } from '../../Template/RefResolver.js';
import type { IDispatchBundle, IPreparedBody } from '../Steps/RunStep.types.js';
import { type IOpenedAnswer, KEY_INVALID, openForStep, stepFail } from './RunStep.codec.open.js';

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
 * Seal the prepared body under the carried session.
 * @param codec - Sealed codec config.
 * @param prepared - Guarded body and scope.
 * @returns The sealed body, or `envelope key invalid` / `envelope body invalid`.
 */
function sealSealedBody(codec: IEnvelopeSealed, prepared: IPreparedBody): Procedure<IPreparedBody> {
  const session = sessionOf(codec, prepared.scope);
  if (session === false) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  const sealed = sealEnvelope(session, prepared.body as JsonValue);
  if (!isOk(sealed)) return sealed;
  return succeed({ body: sealed.value, scope: prepared.scope });
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

export { openSealedAnswer, sealSealedBody };
