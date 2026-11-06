/**
 * Beinleumi mocked bank — the server half of the Transmit envelope. The
 * client draws a fresh secp256k1 key every run, so the bank derives the shared
 * key from the point the key exchange names, then opens each sealed request
 * and seals each answer under it.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { createDecipheriv, createECDH, createHash, type ECDH } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import { sealUnder } from '../../Helpers/EnvelopeExchangeOracle.js';
import { ENVELOPE_IV_TEXT } from '../../Helpers/EnvelopeOracle.js';
import { json } from '../Helpers/MockReplies.js';
import { BN_CRYPTO_SESSION } from './BeinleumiMockData.js';

/** The bank's own synthetic scalar. */
const SERVER_PRIVATE = Buffer.alloc(32, 0x44);

const CIPHER = 'aes-256-cbc';

/** A sealed request's keys, in the order the client writes them. */
const SEALED_KEYS = ['headers', 'enc_headers', 'data'];

/** The header every answer names its IV and session under. */
const ENCRYPTION_HEADER = {
  type: 'encryption',
  iv: ENVELOPE_IV_TEXT,
  crypto_session_id: BN_CRYPTO_SESSION,
};

/** A sealed request, opened: the session it names, its headers and its data. */
export interface IOpenedRequest {
  readonly session: string;
  readonly headers: readonly JsonUnknownRecord[];
  readonly data: JsonUnknownRecord;
}

/** A request as the client seals it. */
interface ISealedRequest {
  readonly headers?: readonly JsonUnknownRecord[];
  readonly enc_headers?: readonly string[];
  readonly data?: string;
}

/**
 * The bank's key pair.
 * @returns The secp256k1 pair over the synthetic scalar.
 */
function serverEcdh(): ECDH {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(SERVER_PRIVATE);
  return ecdh;
}

/**
 * The bank's public point, as the key-exchange answer names it.
 * @returns The uncompressed point, base64.
 */
export function serverPoint(): string {
  return serverEcdh().getPublicKey('base64');
}

/**
 * The envelope key shared with a client point.
 * @param clientPoint - The point the key exchange named, base64.
 * @returns SHA-256 of the ECDH secret, or false for a point off the curve.
 */
export function sharedKeyOf(clientPoint: string): Buffer | false {
  const point = Buffer.from(clientPoint, 'base64');
  try {
    const secret = serverEcdh().computeSecret(point);
    return createHash('sha256').update(secret).digest();
  } catch {
    return false;
  }
}

/**
 * Open one sealed part.
 * @param key - The envelope key.
 * @param iv - The request's IV.
 * @param sealed - The part, base64.
 * @returns The JSON record it seals.
 */
function openPart(key: Buffer, iv: Buffer, sealed: string): JsonUnknownRecord {
  const decipher = createDecipheriv(CIPHER, key, iv);
  const head = decipher.update(sealed, 'base64');
  const tail = decipher.final();
  const text = Buffer.concat([head, tail]).toString('utf8');
  return JSON.parse(text) as JsonUnknownRecord;
}

/**
 * Open a request sealed the way the client seals it: one encryption header,
 * each header sealed apart, the data sealed last, all under one IV.
 * @param key - The envelope key.
 * @param body - The request body.
 * @returns The opened request, or false when it is not sealed under the key.
 */
export function openRequest(key: Buffer, body: JsonUnknownRecord): IOpenedRequest | false {
  const sealed = body as ISealedRequest;
  const [encryption] = sealed.headers ?? [];
  const keys = Object.keys(body);
  const isFramed = isDeepStrictEqual(keys, SEALED_KEYS) && sealed.headers?.length === 1;
  if (!isFramed || encryption.type !== 'encryption') return false;
  try {
    const iv = Buffer.from(encryption.iv as string, 'base64');
    const open = openPart.bind(null, key, iv);
    const headers = (sealed.enc_headers ?? []).map(open);
    const data = open(sealed.data ?? '');
    return { session: String(encryption.crypto_session_id), headers, data };
  } catch {
    return false;
  }
}

/**
 * The bank's answer, its record sealed under the key.
 * @param key - The envelope key.
 * @param record - The answer record.
 * @param headers - Plaintext headers ahead of the encryption header.
 * @returns The sealed answer.
 */
export function sealedReply(
  key: Buffer,
  record: JsonUnknownRecord,
  headers: readonly JsonUnknownRecord[] = [],
): Response {
  const data = sealUnder(key, record);
  return json({ headers: [...headers, ENCRYPTION_HEADER], data });
}

/**
 * The bank's answer with its record left in clear: framed like a sealed one,
 * so only the envelope check can refuse it.
 * @param record - The answer record.
 * @param headers - Plaintext headers ahead of the encryption header.
 * @returns The unsealed answer.
 */
export function plainReply(
  record: JsonUnknownRecord,
  headers: readonly JsonUnknownRecord[] = [],
): Response {
  return json({ headers: [...headers, ENCRYPTION_HEADER], data: record });
}
