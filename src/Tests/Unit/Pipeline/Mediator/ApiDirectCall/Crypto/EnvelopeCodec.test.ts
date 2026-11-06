/**
 * The AES-256-CBC envelope codec. Sealing a `{ headers, data }`
 * body encrypts each header and the data under one shared IV, matching openssl
 * byte for byte. Opening accepts only one well-formed answer sealed for our
 * session; a plaintext answer is never opened. Failures name no key, IV or
 * plaintext.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IEnvelopeSession,
  sealEnvelope,
  sealEnvelopeWithIv,
  toSession,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/EnvelopeCodec.js';
import { openEnvelope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/EnvelopeCodec.open.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import {
  aesOpen,
  aesSeal,
  ENVELOPE_IV,
  ENVELOPE_IV_TEXT,
  ENVELOPE_KEY_TEXT,
  ENVELOPE_SESSION_ID,
  OPENSSL_GOLDENS,
  sealedAnswer,
} from '../../../../../Helpers/EnvelopeOracle.js';

const ENCRYPTION = {
  type: 'encryption',
  iv: ENVELOPE_IV_TEXT,
  crypto_session_id: ENVELOPE_SESSION_ID,
};
const GREETING = { r: 'Hello Encrypted World' };
const FLOW_HEADER = { type: 'flow_id', flow_id: 'F00D' };
const SHORT_BLOCK = Buffer.alloc(15).toString('base64');
const NOT_UTF8 = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);

/**
 * The synthetic session, which must be accepted.
 * @returns The session.
 */
function syntheticSession(): IEnvelopeSession {
  const session = toSession(ENVELOPE_KEY_TEXT, ENVELOPE_SESSION_ID);
  if (session === false) throw new TypeError('synthetic session refused');
  return session;
}

/**
 * An answer with the given encryption headers over the greeting data.
 * @param headers - The answer's headers.
 * @returns The answer.
 */
function answerWith(headers: readonly JsonValue[]): JsonValue {
  return { headers, data: OPENSSL_GOLDENS.greeting.cipher };
}

/**
 * An answer whose data is the given plaintext bytes, sealed.
 * @param plain - Plaintext bytes or text.
 * @returns The answer.
 */
function answerOfPlain(plain: Buffer | string): JsonValue {
  const data = aesSeal(plain);
  return { headers: [ENCRYPTION], data };
}

describe('toSession', () => {
  it('accepts a canonical 32-byte key and a 1..512 character id', () => {
    const session = syntheticSession();
    expect(session.id).toBe(ENVELOPE_SESSION_ID);
    const keyText = session.key.toString('base64');
    expect(keyText).toBe(ENVELOPE_KEY_TEXT);
    const longestId = 'i'.repeat(512);
    const longest = toSession(ENVELOPE_KEY_TEXT, longestId);
    expect(longest).not.toBe(false);
  });

  it.each([
    ['a non-canonical key', ENVELOPE_KEY_TEXT.replace('=', ''), ENVELOPE_SESSION_ID],
    ['a 16-byte key', Buffer.alloc(16, 1).toString('base64'), ENVELOPE_SESSION_ID],
    ['an empty key', '', ENVELOPE_SESSION_ID],
    ['an empty id', ENVELOPE_KEY_TEXT, ''],
    ['a 513-character id', ENVELOPE_KEY_TEXT, 'i'.repeat(513)],
  ])('refuses %s', (_label: string, keyText: string, id: string) => {
    const session = toSession(keyText, id);
    expect(session).toBe(false);
  });
});

describe('sealEnvelopeWithIv (sealed)', () => {
  it('matches the openssl goldens, one IV for every part', () => {
    const session = syntheticSession();
    const body = { headers: [FLOW_HEADER], data: GREETING };
    const sealed = sealEnvelopeWithIv(session, body, ENVELOPE_IV);
    expect(sealed).toEqual({
      success: true,
      value: {
        headers: [ENCRYPTION],
        enc_headers: [OPENSSL_GOLDENS.flowHeader.cipher],
        data: OPENSSL_GOLDENS.greeting.cipher,
      },
    });
  });

  it('writes the data as UTF-8 JSON', () => {
    const session = syntheticSession();
    const body = { headers: [], data: { note: 'שלום' } };
    const sealed = sealEnvelopeWithIv(session, body, ENVELOPE_IV);
    if (!sealed.success) throw new TypeError(sealed.errorMessage);
    expect(sealed.value.data).toBe(OPENSSL_GOLDENS.hebrew.cipher);
    expect(sealed.value.enc_headers).toEqual([]);
  });

  it.each([
    ['a non-record body', ['headers']],
    ['a body with an extra field', { headers: [], data: {}, extra: 1 }],
    ['a body without data', { headers: [] }],
    ['a body without headers', { data: {} }],
    ['non-array headers', { headers: {}, data: {} }],
    ['a non-record header', { headers: ['flow_id'], data: {} }],
    ['seventeen headers', { headers: Array.from({ length: 17 }, () => FLOW_HEADER), data: {} }],
    ['non-record data', { headers: [], data: 'text' }],
  ])('refuses %s, naming no value', (_label: string, body: JsonValue) => {
    const session = syntheticSession();
    const sealed = sealEnvelopeWithIv(session, body, ENVELOPE_IV);
    expect(sealed).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'envelope body invalid',
    });
  });
});

describe('sealEnvelope', () => {
  it('draws a fresh IV per call and the answer opens to the same data', () => {
    const session = syntheticSession();
    const body = { headers: [], data: GREETING };
    const first = sealEnvelope(session, body);
    const second = sealEnvelope(session, body);
    if (!first.success || !second.success) throw new TypeError('seal failed');
    expect(first.value.headers).not.toEqual(second.value.headers);
    const opened = openEnvelope(session, first.value);
    expect(opened).toEqual({
      success: true,
      value: { headers: first.value.headers, data: GREETING },
    });
  });

  it('seals each header under the IV it names', () => {
    const session = syntheticSession();
    const sealed = sealEnvelope(session, { headers: [FLOW_HEADER], data: GREETING });
    if (!sealed.success) throw new TypeError(sealed.errorMessage);
    const [header] = sealed.value.headers as readonly { readonly iv: string }[];
    const [encHeader] = sealed.value.enc_headers as readonly string[];
    const plain = aesOpen(encHeader, header.iv);
    const parsed = JSON.parse(plain) as JsonValue;
    expect(parsed).toEqual(FLOW_HEADER);
  });
});

describe('openEnvelope (open)', () => {
  it('opens the data and keeps the original headers', () => {
    const session = syntheticSession();
    const sessionHeader = { type: 'session_id', session_id: 'syn-sid' };
    const answer = answerWith([ENCRYPTION, sessionHeader]);
    const opened = openEnvelope(session, answer);
    const value = { headers: [ENCRYPTION, sessionHeader], data: GREETING };
    expect(opened).toEqual({ success: true, value });
  });

  it('accepts an encryption header that names no session and empty enc_headers', () => {
    const session = syntheticSession();
    const header = { type: 'encryption', iv: ENVELOPE_IV_TEXT };
    const answer = { headers: [header], enc_headers: [], data: OPENSSL_GOLDENS.greeting.cipher };
    const opened = openEnvelope(session, answer);
    expect(opened).toEqual({ success: true, value: { headers: [header], data: GREETING } });
  });

  it('opens data just under the 4 194 304-character cap and refuses it just over', () => {
    const session = syntheticSession();
    const under = sealedAnswer({ pad: 'x'.repeat(3_000_000) });
    const over = sealedAnswer({ pad: 'x'.repeat(3_200_000) });
    expect(openEnvelope(session, under as JsonValue).success).toBe(true);
    expect(openEnvelope(session, over as JsonValue).success).toBe(false);
  });

  const foreign = { ...ENCRYPTION, crypto_session_id: 'syn-other' };
  const shortIv = { ...ENCRYPTION, iv: Buffer.alloc(12).toString('base64') };
  const looseIv = { ...ENCRYPTION, iv: ENVELOPE_IV_TEXT.replace('==', '') };
  const filler = { type: 'filler' };
  const greetingCipher = OPENSSL_GOLDENS.greeting.cipher;
  it.each([
    ['a non-record answer', [ENCRYPTION]],
    ['an answer without headers', { data: greetingCipher }],
    ['non-array headers', { headers: ENCRYPTION, data: greetingCipher }],
    ['a non-record header', answerWith([ENCRYPTION, 'session_id'])],
    ['seventeen headers', answerWith([ENCRYPTION, ...Array.from({ length: 16 }, () => filler)])],
    ['non-empty enc_headers', { headers: [ENCRYPTION], enc_headers: ['x'], data: greetingCipher }],
    ['non-array enc_headers', { headers: [ENCRYPTION], enc_headers: 'x', data: greetingCipher }],
    ['a plaintext answer', { headers: [], data: GREETING }],
    ['two encryption headers', answerWith([ENCRYPTION, ENCRYPTION])],
    ['a foreign crypto session', answerWith([foreign])],
    ['a 12-byte IV', answerWith([shortIv])],
    ['a non-canonical IV', answerWith([looseIv])],
    ['a non-canonical data', { headers: [ENCRYPTION], data: greetingCipher.replace('=', '') }],
    ['empty data', { headers: [ENCRYPTION], data: '' }],
    ['non-text data', { headers: [ENCRYPTION], data: 7 }],
    ['data off the block size', { headers: [ENCRYPTION], data: SHORT_BLOCK }],
    ['data that does not decrypt', { headers: [ENCRYPTION], data: 'AAAAAAAAAAAAAAAAAAAAAA==' }],
    ['data that is not UTF-8', answerOfPlain(NOT_UTF8)],
    ['data that is a JSON array', answerOfPlain('[1,2]')],
    ['data that is JSON text', answerOfPlain('"text"')],
    ['data that is not JSON', answerOfPlain('{oops')],
  ])('refuses %s, naming no value', (_label: string, answer: JsonValue) => {
    const session = syntheticSession();
    const opened = openEnvelope(session, answer);
    expect(opened).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'envelope invalid',
    });
  });
});
