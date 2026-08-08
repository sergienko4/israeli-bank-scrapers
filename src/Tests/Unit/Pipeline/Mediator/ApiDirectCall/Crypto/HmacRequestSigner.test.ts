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

import {
  buildHmacCanonical,
  hashBody,
  mintNonce,
  signCanonicalHmac,
  signRequest,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/HmacRequestSigner.js';

/** Synthetic 32-byte session HMAC key (fabricated — not a real secret). */
const HMAC_KEY = Buffer.from(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  'hex',
);

/** SHA-256 of the empty byte array — the empty-body hash constant. */
const EMPTY_BODY_HASH = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

describe('HmacRequestSigner.signCanonicalHmac (synthetic vectors)', () => {
  it('signs a getGroupsList canonical string deterministically', () => {
    const canonical =
      'POST:/api/2.0/getGroupsList:1786105648822:d792c867-1eda-4588-9341-839280615a04:V5ChqxAF6CQCxIQOOAcgT/pR4L9zlq7Fq3KyfWazflQ=';
    const result = signCanonicalHmac(HMAC_KEY, canonical);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('Rov3WPMB7zzAU3Bu6E/mQ8VIyl9F6dGNLzem3CbREJs=');
    }
  });

  it('signs a getUserHistory canonical string deterministically', () => {
    const canonical =
      'POST:/api/2.0/getUserHistory:1786107043346:d086aa92-2c2f-41da-bb9d-fb24abdc6fdc:KSbOfxdDgbbUxMSkfa4WSBBnGDP1GeFRQw7wwO1k2K8=';
    const result = signCanonicalHmac(HMAC_KEY, canonical);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('QJQkrj3ENk6OFq+ce6VgbB0lWwmAhDNcgaMfCPPpDxg=');
    }
  });

  it('rejects an HMAC key that is not 32 bytes', () => {
    const badKey = Buffer.from('too-short', 'utf8');
    const result = signCanonicalHmac(badKey, 'POST:/api/2.0/x:1:n:h');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('32 bytes');
    }
  });
});

describe('HmacRequestSigner.hashBody', () => {
  it('returns the empty-body constant for an empty buffer', () => {
    const emptyBuffer = Buffer.alloc(0);
    const digest = hashBody(emptyBuffer);
    expect(digest).toBe(EMPTY_BODY_HASH);
  });

  it('returns a stable base64 digest for known bytes', () => {
    // SHA-256("abc") = ba7816bf...; base64 of the raw digest is stable.
    const abcBytes = Buffer.from('abc', 'utf8');
    const digest = hashBody(abcBytes);
    expect(digest).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });
});

describe('HmacRequestSigner.buildHmacCanonical', () => {
  it('uppercases the method and joins parts with colons', () => {
    const canonical = buildHmacCanonical({
      method: 'post',
      path: '/api/2.0/getUserHistory',
      timestamp: '1786107043346',
      nonce: 'd086aa92-2c2f-41da-bb9d-fb24abdc6fdc',
      bodyHash: EMPTY_BODY_HASH,
    });
    const expected = `POST:/api/2.0/getUserHistory:1786107043346:d086aa92-2c2f-41da-bb9d-fb24abdc6fdc:${EMPTY_BODY_HASH}`;
    expect(canonical).toBe(expected);
  });
});

describe('HmacRequestSigner.signRequest (composition)', () => {
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
      const expectedBodyHash = hashBody(bodyBytes);
      const isBodyHashSuffix = result.value.canonical.endsWith(result.value.bodyHash);
      const reSign = signCanonicalHmac(HMAC_KEY, result.value.canonical);
      expect(result.value.bodyHash).toBe(expectedBodyHash);
      expect(isBodyHashSuffix).toBe(true);
      if (reSign.success) {
        expect(result.value.signature).toBe(reSign.value);
      }
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
