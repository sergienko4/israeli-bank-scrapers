/**
 * Deterministic seal coverage: `sealEnvelope` uses a fresh IV, so this suite
 * fixes `randomBytes` to the oracle IV and asserts the same openssl goldens
 * the old internal `sealEnvelopeWithIv` test used.
 */

import { createCipheriv } from 'node:crypto';

import { jest } from '@jest/globals';

import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import {
  ENVELOPE_IV,
  ENVELOPE_KEY_TEXT,
  ENVELOPE_SESSION_ID,
  OPENSSL_GOLDENS,
} from '../../../../../Helpers/EnvelopeOracle.js';

jest.unstable_mockModule('node:crypto', () => ({
  /**
   * Use the real AES implementation.
   * @returns The real `createCipheriv`.
   */
  createCipheriv,
  /**
   * Pin the IV the envelope would otherwise draw at random.
   * @returns The oracle IV.
   */
  randomBytes: (): Buffer => ENVELOPE_IV,
}));

const CODEC =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/EnvelopeCodec.js');

const FLOW_HEADER = { type: 'flow_id', flow_id: 'F00D' };
const GREETING = { r: 'Hello Encrypted World' };
const ENCRYPTION = {
  type: 'encryption',
  iv: ENVELOPE_IV.toString('base64'),
  crypto_session_id: ENVELOPE_SESSION_ID,
};

/**
 * Build the synthetic session the oracle uses.
 * @returns The session.
 */
function syntheticSession(): Exclude<ReturnType<typeof CODEC.toSession>, false> {
  const session = CODEC.toSession(ENVELOPE_KEY_TEXT, ENVELOPE_SESSION_ID);
  if (session === false) throw new TypeError('synthetic session refused');
  return session;
}

describe('sealEnvelope with a pinned IV', () => {
  it('matches the openssl goldens, one IV for every part', () => {
    const session = syntheticSession();
    const body = { headers: [FLOW_HEADER], data: GREETING };
    const sealed = CODEC.sealEnvelope(session, body);
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
    const sealed = CODEC.sealEnvelope(session, body);
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
    const sealed = CODEC.sealEnvelope(session, body);
    expect(sealed).toMatchObject({ success: false, errorMessage: 'envelope body invalid' });
  });
});
