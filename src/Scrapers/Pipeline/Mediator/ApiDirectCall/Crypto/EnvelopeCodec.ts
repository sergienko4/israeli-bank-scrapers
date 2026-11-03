/**
 * EnvelopeCodec — the AES-256-CBC envelope session and seal. Seal writes
 * a `{ headers, data }` body as one `encryption` header, the headers each
 * sealed, and the sealed data; every part shares one fresh IV, the vendor's
 * format (TLS gives transport integrity). `EnvelopeCodec.open.ts` opens the
 * answer. Failures name no key, IV or plaintext.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createCipheriv, randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IJsonObject, JsonValue } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import { canonicalBytes, CIPHER, headerList, isJsonRecord, IV_BYTES } from './EnvelopeWire.js';

/** Key length of AES-256. */
const KEY_BYTES = 32;

/** Longest crypto session id accepted. */
const MAX_SESSION_ID_CHARS = 512;

/** A crypto session: the AES key and the id the bank knows it by. */
interface IEnvelopeSession {
  readonly key: Buffer;
  readonly id: string;
}

/** A body ready to seal: its header list and its data. */
interface ISealInput {
  readonly headers: readonly IJsonObject[];
  readonly data: IJsonObject;
}

/**
 * Whether a value is a crypto session id.
 * @param id - Candidate id.
 * @returns True for a 1..512 character text.
 */
function isSessionId(id: JsonValue): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_SESSION_ID_CHARS;
}

/**
 * A session from a carried key and id.
 * @param keyText - Key: canonical base64 of 32 bytes.
 * @param id - Crypto session id.
 * @returns The session, or false when either part is malformed.
 */
function toSession(keyText: string, id: string): IEnvelopeSession | false {
  const key = canonicalBytes(keyText);
  if (key === false || key.length !== KEY_BYTES) return false;
  if (!isSessionId(id)) return false;
  return { key, id };
}

/**
 * Seal one JSON value as UTF-8 JSON.
 * @param value - Value to seal.
 * @param session - Crypto session.
 * @param iv - Shared IV.
 * @returns Ciphertext, base64.
 */
function sealPart(value: JsonValue, session: IEnvelopeSession, iv: Buffer): string {
  const cipher = createCipheriv(CIPHER, session.key, iv);
  const text = JSON.stringify(value);
  const head = cipher.update(text, 'utf8');
  const tail = cipher.final();
  return Buffer.concat([head, tail]).toString('base64');
}

/**
 * The body to seal: exactly `{ headers, data }` with a record list and data.
 * @param body - Hydrated body.
 * @returns Its header list and data, or false when it has another shape.
 */
function sealInput(body: JsonValue): ISealInput | false {
  if (!isJsonRecord(body) || Object.keys(body).length !== 2) return false;
  const headers = headerList(body);
  if (headers === false || !isJsonRecord(body.data)) return false;
  return { headers, data: body.data };
}

/**
 * The sealed envelope of a checked body.
 * @param session - Crypto session.
 * @param input - Header list and data.
 * @param iv - Shared IV.
 * @returns The `encryption` header, the sealed headers and the sealed data.
 */
function sealedOf(session: IEnvelopeSession, input: ISealInput, iv: Buffer): IJsonObject {
  const ivText = iv.toString('base64');
  const header = { type: 'encryption', iv: ivText, crypto_session_id: session.id };
  const encHeaders = input.headers.map((part): string => sealPart(part, session, iv));
  const data = sealPart(input.data, session, iv);
  return { headers: [header], enc_headers: encHeaders, data };
}

/**
 * Seal a `{ headers, data }` body under a given IV.
 * @param session - Crypto session.
 * @param body - Hydrated body.
 * @param iv - 16-byte IV, shared by every part.
 * @returns The sealed envelope, or `envelope body invalid`.
 */
function sealEnvelopeWithIv(
  session: IEnvelopeSession,
  body: JsonValue,
  iv: Buffer,
): Procedure<IJsonObject> {
  const input = sealInput(body);
  if (input === false) return fail(ScraperErrorTypes.Generic, 'envelope body invalid');
  const sealed = sealedOf(session, input, iv);
  return succeed(sealed);
}

/**
 * Seal a `{ headers, data }` body under a fresh IV.
 * @param session - Crypto session.
 * @param body - Hydrated body.
 * @returns The sealed envelope, or `envelope body invalid`.
 */
function sealEnvelope(session: IEnvelopeSession, body: JsonValue): Procedure<IJsonObject> {
  const iv = randomBytes(IV_BYTES);
  return sealEnvelopeWithIv(session, body, iv);
}

export type { IEnvelopeSession };
export { isSessionId, sealEnvelope, sealEnvelopeWithIv, toSession };
