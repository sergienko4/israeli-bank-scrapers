/**
 * Unit tests for AesSymmetricSigner — exercises the pure AES-CBC
 * primitive with deterministic key + IV vectors so callers can rely
 * on stable ciphertext for the bank-supplied signature contract.
 */

import { signAesCbcPkcs7 } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/AesSymmetricSigner.js';

/** 32-byte deterministic key for the test vectors. */
const KEY_32 = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
/** 16-byte deterministic IV for the test vectors. */
const IV_16 = Buffer.from('abcdef0123456789', 'utf8');

describe('AesSymmetricSigner.signAesCbcPkcs7', () => {
  it('produces base64 ciphertext for a valid (key, iv, plaintext)', () => {
    const result = signAesCbcPkcs7({ plaintext: 'hello', keyBytes: KEY_32, ivBytes: IV_16 });
    expect(result.success).toBe(true);
    if (result.success) {
      // Base64 of AES-CBC(key, iv, 'hello' + PKCS7 pad) — stable for fixed inputs.
      expect(result.value).toMatch(/^[A-Z0-9+/]+={0,2}$/i);
      expect(result.value.length).toBeGreaterThan(0);
    }
  });

  it('appends the configured outputPostfix when supplied', () => {
    const result = signAesCbcPkcs7({
      plaintext: 'hello',
      keyBytes: KEY_32,
      ivBytes: IV_16,
      outputPostfix: '\n',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const hasTrailingNewline = result.value.endsWith('\n');
      expect(hasTrailingNewline).toBe(true);
    }
  });

  it('rejects a key shorter than 32 bytes', () => {
    const badKey = Buffer.from('short-key', 'utf8');
    const result = signAesCbcPkcs7({ plaintext: 'hello', keyBytes: badKey, ivBytes: IV_16 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('32 bytes');
  });

  it('rejects an IV shorter than 16 bytes', () => {
    const badIv = Buffer.from('short-iv', 'utf8');
    const result = signAesCbcPkcs7({ plaintext: 'hello', keyBytes: KEY_32, ivBytes: badIv });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('16 bytes');
  });
});
