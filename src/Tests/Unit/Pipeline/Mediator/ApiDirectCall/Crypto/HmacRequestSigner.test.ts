/**
 * Unit tests for HmacRequestSigner — the generic per-request HMAC
 * signature primitive.
 *
 * The HMAC vectors below are SYNTHETIC: the key is a fabricated 32-byte
 * value (never a real captured session key) and each expected signature
 * is the deterministic HMAC-SHA256 of the canonical string under that
 * key, computed offline. They assert the signer is a correct,
 * deterministic HMAC-SHA256 without embedding any real user secret.
 */

import { createHash, createHmac } from 'node:crypto';

import {
  mintNonce,
  signRequest,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/HmacRequestSigner.js';

/** Synthetic 32-byte session HMAC key (fabricated — not a real secret). */
const HMAC_KEY = Buffer.from(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  'hex',
);

/** SHA-256 of the empty byte array — the empty-body hash constant. */
const EMPTY_BODY_HASH = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

describe('HmacRequestSigner.signRequest (composition)', () => {
  it('hashes the empty body to the well-known digest', () => {
    const result = signRequest({
      method: 'GET',
      path: '/api/2.0/getAppConfigurations',
      bodyBytes: Buffer.alloc(0),
      hmacKey: HMAC_KEY,
      timestamp: '1',
      nonce: 'n',
    });
    if (!result.success) throw new TypeError(result.errorMessage);
    expect(result.value.bodyHash).toBe(EMPTY_BODY_HASH);
  });

  it('hashes known bytes', () => {
    const result = signRequest({
      method: 'POST',
      path: '/api/2.0/x',
      bodyBytes: Buffer.from('abc', 'utf8'),
      hmacKey: HMAC_KEY,
      timestamp: '1',
      nonce: 'n',
    });
    if (!result.success) throw new TypeError(result.errorMessage);
    expect(result.value.bodyHash).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });

  it('assembles the canonical string', () => {
    const result = signRequest({
      method: 'post',
      path: '/api/2.0/getUserHistory',
      bodyBytes: Buffer.alloc(0),
      hmacKey: HMAC_KEY,
      timestamp: '1786107043346',
      nonce: 'd086aa92-2c2f-41da-bb9d-fb24abdc6fdc',
    });
    if (!result.success) throw new TypeError(result.errorMessage);
    const expected = `POST:/api/2.0/getUserHistory:1786107043346:d086aa92-2c2f-41da-bb9d-fb24abdc6fdc:${EMPTY_BODY_HASH}`;
    expect(result.value.canonical).toBe(expected);
  });

  it('hashes the body, builds the canonical, and signs consistently', () => {
    const bodyBytes = Buffer.from('{"k":"v"}', 'utf8');
    const result = signRequest({
      method: 'POST',
      path: '/api/2.0/getUserHistory',
      bodyBytes,
      hmacKey: HMAC_KEY,
      timestamp: '1786107043346',
      nonce: 'd086aa92-2c2f-41da-bb9d-fb24abdc6fdc',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const expectedBodyHash = createHash('sha256').update(bodyBytes).digest('base64');
      const isBodyHashSuffix = result.value.canonical.endsWith(result.value.bodyHash);
      const expectedSignature = createHmac('sha256', HMAC_KEY)
        .update(result.value.canonical)
        .digest('base64');
      expect(result.value.bodyHash).toBe(expectedBodyHash);
      expect(isBodyHashSuffix).toBe(true);
      expect(result.value.signature).toBe(expectedSignature);
    }
  });

  it('produces the empty-body hash when signing an empty body', () => {
    const result = signRequest({
      method: 'GET',
      path: '/api/2.0/getAppConfigurations',
      bodyBytes: Buffer.alloc(0),
      hmacKey: HMAC_KEY,
      timestamp: '1',
      nonce: 'n',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.bodyHash).toBe(EMPTY_BODY_HASH);
    }
  });

  it('fails closed when the HMAC key is not 32 bytes', () => {
    const result = signRequest({
      method: 'POST',
      path: '/api/2.0/getUserHistory',
      bodyBytes: Buffer.from('{}', 'utf8'),
      hmacKey: Buffer.from('short', 'utf8'),
      timestamp: '1',
      nonce: 'n',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('32 bytes');
    }
  });
});

describe('HmacRequestSigner minting helpers', () => {
  it('mintNonce returns a lowercase hyphenated UUID', () => {
    const nonce = mintNonce();
    expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
