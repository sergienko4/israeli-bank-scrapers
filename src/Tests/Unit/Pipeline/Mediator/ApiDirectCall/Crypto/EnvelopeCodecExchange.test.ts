/**
 * Exchange mode — the bank's `key_exchange` header and the carried client
 * scalar make the session: the key is SHA-256 of the ECDH secret, the id the
 * header's `crypto_session_id`. Tests check it against an independent peer.
 * Any malformed header, point or scalar is refused, naming no value.
 */

import type { ECDH } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  exchangeSession,
  toExchangeKey,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/EnvelopeCodec.exchange.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import {
  CLIENT_PRIVATE,
  CLIENT_PRIVATE_TEXT,
  exchangeAnswer,
  keyExchangeHeader,
  peerKey,
  serverPublic,
} from '../../../../../Helpers/EnvelopeExchangeOracle.js';
import { ENVELOPE_SESSION_ID } from '../../../../../Helpers/EnvelopeOracle.js';

const GREETING = { r: 'Hello Encrypted World' };
const ENCRYPTION_ONLY = { type: 'encryption', iv: 'AAAAAAAAAAAAAAAAAAAAAA==' };
const UNPADDED_POINT = serverPublic().replace(/=+$/u, '');
const SHORT_POINT = Buffer.alloc(64, 4).toString('base64');
const WRONG_PREFIX = Buffer.concat([Buffer.from([5]), Buffer.alloc(64, 1)]).toString('base64');
const COMPRESSED_04 = Buffer.concat([Buffer.from([4]), Buffer.alloc(32, 1)]).toString('base64');
const OFF_CURVE = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64');
const UNPADDED_PRIVATE = CLIENT_PRIVATE_TEXT.replace(/=+$/u, '');
const SCALAR_31 = Buffer.alloc(31, 0x22).toString('base64');
const SCALAR_33 = Buffer.alloc(33, 0x22).toString('base64');
const ZERO_SCALAR = Buffer.alloc(32).toString('base64');
const PAST_ORDER = Buffer.alloc(32, 0xff).toString('base64');
const LONGEST_ID = 'i'.repeat(512);
const TOO_LONG_ID = 'i'.repeat(513);

/**
 * The client key pair, which must be accepted.
 * @returns The key pair.
 */
function clientKey(): ECDH {
  const ecdh = toExchangeKey(CLIENT_PRIVATE_TEXT);
  if (ecdh === false) throw new TypeError('synthetic client key refused');
  return ecdh;
}

/**
 * An answer whose only header list is the given one.
 * @param headers - Header list before the encryption header.
 * @returns The answer.
 */
function answerWith(headers: readonly Readonly<Record<string, unknown>>[]): JsonValue {
  return exchangeAnswer(GREETING, headers) as JsonValue;
}

describe('toExchangeKey', () => {
  it('accepts the carried 32-byte scalar', () => {
    const ecdh = clientKey();
    const scalar = ecdh.getPrivateKey();
    const isCarried = scalar.equals(CLIENT_PRIVATE);
    expect(isCarried).toBe(true);
  });

  it.each([
    ['empty text', ''],
    ['non-canonical base64', UNPADDED_PRIVATE],
    ['a 31-byte scalar', SCALAR_31],
    ['a 33-byte scalar', SCALAR_33],
    ['the zero scalar', ZERO_SCALAR],
    ['a scalar past the curve order', PAST_ORDER],
  ])('refuses %s', (_label: string, text: string) => {
    const ecdh = toExchangeKey(text);
    expect(ecdh).toBe(false);
  });
});

describe('exchangeSession', () => {
  it('derives the key the bank derives, and its session id', () => {
    const answer = exchangeAnswer(GREETING) as JsonValue;
    const ecdh = clientKey();
    const session = exchangeSession(ecdh, answer);
    if (!session.success) throw new TypeError(session.errorMessage);
    const expected = peerKey();
    const isPeerKey = session.value.key.equals(expected);
    expect(isPeerKey).toBe(true);
    expect(session.value.id).toBe(ENVELOPE_SESSION_ID);
  });

  it('accepts a compressed bank point and the longest session id', () => {
    const y = serverPublic('compressed');
    const header = keyExchangeHeader({ y, crypto_session_id: LONGEST_ID });
    const answer = answerWith([header]);
    const ecdh = clientKey();
    const session = exchangeSession(ecdh, answer);
    if (!session.success) throw new TypeError(session.errorMessage);
    const expected = peerKey();
    const isPeerKey = session.value.key.equals(expected);
    expect(isPeerKey).toBe(true);
    expect(session.value.id).toBe(LONGEST_ID);
  });

  it.each([
    ['an answer that is not a record', ['x']],
    ['headers that are not a list', { headers: 'x', data: 'AA==' }],
    ['no key_exchange header', answerWith([])],
    ['two key_exchange headers', answerWith([keyExchangeHeader(), keyExchangeHeader()])],
    ['scheme 1', answerWith([keyExchangeHeader({ scheme: 1 })])],
    ['scheme as text', answerWith([keyExchangeHeader({ scheme: '2' })])],
    ['no scheme', answerWith([keyExchangeHeader({ scheme: null })])],
    ['an empty session id', answerWith([keyExchangeHeader({ crypto_session_id: '' })])],
    ['a session id past 512', answerWith([keyExchangeHeader({ crypto_session_id: TOO_LONG_ID })])],
    ['a numeric session id', answerWith([keyExchangeHeader({ crypto_session_id: 7 })])],
    ['no point', answerWith([keyExchangeHeader({ y: null })])],
    ['an empty point', answerWith([keyExchangeHeader({ y: '' })])],
    ['a non-canonical point', answerWith([keyExchangeHeader({ y: UNPADDED_POINT })])],
    ['a 64-byte point', answerWith([keyExchangeHeader({ y: SHORT_POINT })])],
    ['a 65-byte point not led by 0x04', answerWith([keyExchangeHeader({ y: WRONG_PREFIX })])],
    ['a 33-byte point led by 0x04', answerWith([keyExchangeHeader({ y: COMPRESSED_04 })])],
    ['a point off the curve', answerWith([keyExchangeHeader({ y: OFF_CURVE })])],
    ['only an encryption header', { headers: [ENCRYPTION_ONLY], data: 'AA==' }],
  ])('refuses %s, naming no value', (_label: string, answer: JsonValue) => {
    const ecdh = clientKey();
    const session = exchangeSession(ecdh, answer);
    expect(session).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'envelope invalid',
    });
  });
});
