/**
 * EnvelopeCodec.open — open an AES-256-CBC envelope answer. Only one
 * well-formed answer sealed for our session opens: its `headers` are at
 * most 16 records, `enc_headers` is absent or empty, exactly one `encryption`
 * header names our session or none, and its data decrypts to a strict UTF-8
 * JSON record. A plaintext answer never opens. Failures name no key, IV or
 * plaintext.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createDecipheriv } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IJsonObject, JsonValue } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IEnvelopeSession } from './EnvelopeCodec.js';
import {
  canonicalBytes,
  CIPHER,
  headerList,
  headersOfType,
  isJsonRecord,
  IV_BYTES,
} from './EnvelopeWire.js';

/** AES block length. */
const BLOCK_BYTES = 16;

/** UTF-8 decoder that throws on a malformed sequence. */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

const ENVELOPE_INVALID = 'envelope invalid';

/** The decoded parts of an answer sealed for our session. */
interface ISealedParts {
  readonly iv: Buffer;
  readonly cipher: Buffer;
}

/**
 * Whether an answer's `enc_headers` is absent or empty.
 * @param answer - Answer record.
 * @returns True when the answer seals no headers.
 */
function hasNoEncHeaders(answer: IJsonObject): boolean {
  if (!Object.hasOwn(answer, 'enc_headers')) return true;
  const encHeaders = answer.enc_headers;
  return Array.isArray(encHeaders) && encHeaders.length === 0;
}

/**
 * Whether an `encryption` header names our session, or names none.
 * @param header - The `encryption` header.
 * @param sessionId - Our crypto session id.
 * @returns True when the header may be ours.
 */
function namesSession(header: IJsonObject, sessionId: string): boolean {
  if (!Object.hasOwn(header, 'crypto_session_id')) return true;
  return header.crypto_session_id === sessionId;
}

/**
 * The answer's one `encryption` header, when it may be ours.
 * @param answer - Answer record.
 * @param sessionId - Our crypto session id.
 * @returns The header, or false when the headers or the match are wrong.
 */
function encryptionHeaderOf(answer: IJsonObject, sessionId: string): IJsonObject | false {
  const headers = headerList(answer);
  if (headers === false) return false;
  const matches = headersOfType(headers, 'encryption');
  if (matches.length !== 1 || !namesSession(matches[0], sessionId)) return false;
  return matches[0];
}

/**
 * The 16-byte IV an `encryption` header names.
 * @param header - The `encryption` header.
 * @returns The IV, or false when it is not canonical base64 of 16 bytes.
 */
function ivOf(header: IJsonObject): Buffer | false {
  const iv = canonicalBytes(header.iv);
  if (iv === false || iv.length !== IV_BYTES) return false;
  return iv;
}

/**
 * The sealed data: canonical base64 of whole AES blocks.
 * @param answer - Answer record.
 * @returns The ciphertext, or false when it is malformed.
 */
function cipherOf(answer: IJsonObject): Buffer | false {
  const cipher = canonicalBytes(answer.data);
  if (cipher === false || cipher.length % BLOCK_BYTES !== 0) return false;
  return cipher;
}

/**
 * The IV and ciphertext of an answer sealed for our session.
 * @param answer - Answer record.
 * @param sessionId - Our crypto session id.
 * @returns The parts, or false when the answer is not such an envelope.
 */
function sealedPartsOf(answer: IJsonObject, sessionId: string): ISealedParts | false {
  if (!hasNoEncHeaders(answer)) return false;
  const header = encryptionHeaderOf(answer, sessionId);
  if (header === false) return false;
  const iv = ivOf(header);
  const cipher = cipherOf(answer);
  if (iv === false || cipher === false) return false;
  return { iv, cipher };
}

/**
 * Decrypt the ciphertext; throws when the padding is wrong.
 * @param session - Crypto session.
 * @param parts - IV and ciphertext.
 * @returns The plaintext bytes.
 */
function decipherBytes(session: IEnvelopeSession, parts: ISealedParts): Buffer {
  const decipher = createDecipheriv(CIPHER, session.key, parts.iv);
  const head = decipher.update(parts.cipher);
  const tail = decipher.final();
  return Buffer.concat([head, tail]);
}

/**
 * Parse plaintext bytes as a strict UTF-8 JSON record; throws on bad text.
 * @param clear - Plaintext bytes.
 * @returns The record, or false when the JSON is not a record.
 */
function parseRecord(clear: Buffer): IJsonObject | false {
  const text = STRICT_UTF8.decode(clear);
  const parsed = JSON.parse(text) as JsonValue;
  if (!isJsonRecord(parsed)) return false;
  return parsed;
}

/**
 * Open an answer record sealed for our session, without throwing.
 * @param session - Crypto session.
 * @param answer - Answer record.
 * @returns The opened data, or false.
 */
function openRecord(session: IEnvelopeSession, answer: IJsonObject): IJsonObject | false {
  const parts = sealedPartsOf(answer, session.id);
  if (parts === false) return false;
  try {
    const clear = decipherBytes(session, parts);
    return parseRecord(clear);
  } catch {
    return false;
  }
}

/**
 * Open an answer sealed for our session (never a plaintext one).
 * @param session - Crypto session.
 * @param answer - Parsed answer.
 * @returns `{ headers, data }` with the original headers and the opened data,
 *   or `envelope invalid`.
 */
function openEnvelope(session: IEnvelopeSession, answer: JsonValue): Procedure<IJsonObject> {
  if (!isJsonRecord(answer)) return fail(ScraperErrorTypes.Generic, ENVELOPE_INVALID);
  const data = openRecord(session, answer);
  if (data === false) return fail(ScraperErrorTypes.Generic, ENVELOPE_INVALID);
  return succeed({ headers: answer.headers, data });
}

export default openEnvelope;
export { openEnvelope };
