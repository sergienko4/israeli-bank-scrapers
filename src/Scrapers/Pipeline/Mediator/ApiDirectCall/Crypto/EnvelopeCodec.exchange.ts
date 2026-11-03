/**
 * EnvelopeCodec.exchange — the scheme-2 key exchange of the AES-CBC envelope.
 * The bank's one `key_exchange` header names its secp256k1 point `y`
 * and the crypto session id; the session key is SHA-256 of the ECDH secret of
 * that point and the carried client scalar. Failures name no key or point.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createECDH, createHash, type ECDH } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IJsonObject, JsonValue } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import { type IEnvelopeSession, isSessionId } from './EnvelopeCodec.js';
import { canonicalBytes, headerList, headersOfType, isJsonRecord } from './EnvelopeWire.js';

/** The curve of key-exchange scheme 2. */
const CURVE = 'secp256k1';

/** Byte length of a secp256k1 private scalar. */
const PRIVATE_KEY_BYTES = 32;

/** The one key-exchange scheme spoken. */
const SCHEME = 2;

/** A SEC1 point encoding: its byte length and the lead bytes it may start with. */
interface IPointForm {
  readonly bytes: number;
  readonly leads: readonly number[];
}

/** Uncompressed and compressed SEC1 points. */
const POINT_FORMS: readonly IPointForm[] = [
  { bytes: 65, leads: [0x04] },
  { bytes: 33, leads: [0x02, 0x03] },
];

/** The bank's half of the exchange: its point and the session id. */
interface IKeyExchange {
  readonly y: JsonValue;
  readonly id: string;
}

/**
 * A key pair on the exchange curve from a private scalar.
 * @param scalar - Private scalar.
 * @returns The key pair, or false when the curve refuses the scalar.
 */
function ecdhOf(scalar: Buffer): ECDH | false {
  try {
    const ecdh = createECDH(CURVE);
    ecdh.setPrivateKey(scalar);
    return ecdh;
  } catch {
    return false;
  }
}

/**
 * The client key pair from its carried scalar.
 * @param privateText - Scalar: canonical base64 of 32 bytes.
 * @returns The key pair, or false when the scalar is malformed or off the curve's range.
 */
function toExchangeKey(privateText: string): ECDH | false {
  const scalar = canonicalBytes(privateText);
  if (scalar === false || scalar.length !== PRIVATE_KEY_BYTES) return false;
  return ecdhOf(scalar);
}

/**
 * The bank's half of the exchange from its one scheme-2 header.
 * @param headers - Answer headers.
 * @returns The point and session id, or false.
 */
function exchangeOf(headers: readonly IJsonObject[]): IKeyExchange | false {
  const matches = headersOfType(headers, 'key_exchange');
  if (matches.length !== 1) return false;
  const [header] = matches;
  if (header.scheme !== SCHEME || !isSessionId(header.crypto_session_id)) return false;
  return { y: header.y, id: header.crypto_session_id };
}

/**
 * The bank's half of the exchange from its answer.
 * @param answer - Parsed answer.
 * @returns The point and session id, or false.
 */
function keyExchangeOf(answer: JsonValue): IKeyExchange | false {
  if (!isJsonRecord(answer)) return false;
  const headers = headerList(answer);
  if (headers === false) return false;
  return exchangeOf(headers);
}

/**
 * The bank's point, in a SEC1 form.
 * @param y - Point, canonical base64.
 * @returns The point bytes, or false.
 */
function serverPoint(y: JsonValue): Buffer | false {
  const point = canonicalBytes(y);
  if (point === false) return false;
  const [lead] = point;
  const isForm = POINT_FORMS.some(
    (form): boolean => form.bytes === point.length && form.leads.includes(lead),
  );
  return isForm ? point : false;
}

/**
 * SHA-256 of the ECDH secret.
 * @param ecdh - Client key pair.
 * @param point - Bank point.
 * @returns The 32-byte session key, or false when the point is off the curve.
 */
function sessionKey(ecdh: ECDH, point: Buffer): Buffer | false {
  try {
    const secret = ecdh.computeSecret(point);
    return createHash('sha256').update(secret).digest();
  } catch {
    return false;
  }
}

/**
 * Derive the session from the answer's exchange header and the client key pair.
 * @param ecdh - Client key pair.
 * @param answer - Parsed answer.
 * @returns The session, or false when the header, point or secret is unsound.
 */
function deriveSession(ecdh: ECDH, answer: JsonValue): IEnvelopeSession | false {
  const exchange = keyExchangeOf(answer);
  if (exchange === false) return false;
  const point = serverPoint(exchange.y);
  if (point === false) return false;
  const key = sessionKey(ecdh, point);
  if (key === false) return false;
  return { key, id: exchange.id };
}

/**
 * The crypto session a key-exchange answer and the client key pair make.
 * @param ecdh - Client key pair.
 * @param answer - Parsed answer.
 * @returns The session, or `envelope invalid`.
 */
function exchangeSession(ecdh: ECDH, answer: JsonValue): Procedure<IEnvelopeSession> {
  const session = deriveSession(ecdh, answer);
  if (session === false) return fail(ScraperErrorTypes.Generic, 'envelope invalid');
  return succeed(session);
}

export { exchangeSession, toExchangeKey };
