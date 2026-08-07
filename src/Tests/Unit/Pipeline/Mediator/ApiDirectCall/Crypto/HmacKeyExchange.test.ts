/**
 * Unit tests for HmacKeyExchange — the key-exchange → HMAC-key
 * primitive.
 *
 * The ciphertext / IV / derived-key vectors below are SYNTHETIC: they
 * are fabricated offline (never a real phone number or captured secret)
 * and are self-consistent by construction — the ciphertext is an
 * AES-256-CBC encryption of {@link EXPECTED_HMAC_KEY_HEX} (as an ASCII
 * hex string) under the key derived from `SEED + SALT`, so the decrypt
 * round-trips without embedding any real user PII in the repo.
 */

import { createCipheriv } from 'node:crypto';

import {
  decryptExchangedHmacKey,
  deriveExchangeKey,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/HmacKeyExchange.js';

/** Synthetic key-exchange ciphertext (base64). */
const CIPHERTEXT_B64 =
  'pxjyMHncrJcR805CNvcKpifVRcy+p0osdYW+it992A4/xCKyOx0SCVmN+KsTvW1HzTnKg+W66mFyNQPecjzdX7BRJUr+ib10Y3G9ddbNqxg=';
/** Synthetic key-exchange IV (hex). */
const IV_HEX = '0123456789abcdef0123456789abcdef';
/** Expected decrypted plaintext — the raw HMAC key as a hex string. */
const EXPECTED_HMAC_KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
/** Synthetic seed (phone formatted `<cc>-<national>`) + static salt. */
const SEED = '972-500000000';
const SALT = '%as2@1FaY$)(mLq%!cx';

describe('HmacKeyExchange.deriveExchangeKey', () => {
  it('builds the exact 32-byte AES key from the seed + salt', () => {
    const key = deriveExchangeKey({ seed: SEED, salt: SALT, length: 32, padChar: 'a' });
    expect(key).toHaveLength(32);
    const keyStr = key.toString('utf8');
    expect(keyStr).toBe('972-500000000%as2@1FaY$)(mLq%!cx');
  });

  it('truncates a combined string longer than the target length', () => {
    const key = deriveExchangeKey({ seed: 'abcdefghij', salt: 'klmnop', length: 8, padChar: 'a' });
    const keyStr = key.toString('utf8');
    expect(keyStr).toBe('abcdefgh');
  });

  it('right-pads a short combined string with the pad char', () => {
    const key = deriveExchangeKey({ seed: 'ab', salt: 'cd', length: 8, padChar: 'a' });
    const keyStr = key.toString('utf8');
    expect(keyStr).toBe('abcdaaaa');
  });
});

describe('HmacKeyExchange.decryptExchangedHmacKey (synthetic vector)', () => {
  it('decrypts the ciphertext to the 32-byte HMAC key', () => {
    const keyBytes = deriveExchangeKey({ seed: SEED, salt: SALT, length: 32, padChar: 'a' });
    const result = decryptExchangedHmacKey({
      ciphertextB64: CIPHERTEXT_B64,
      ivHex: IV_HEX,
      keyBytes,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toHaveLength(32);
      const hex = result.value.toString('hex');
      expect(hex).toBe(EXPECTED_HMAC_KEY_HEX);
    }
  });

  it('fails cleanly when the derived key is wrong (bad decrypt padding)', () => {
    const wrongKey = Buffer.alloc(32, 0);
    const result = decryptExchangedHmacKey({
      ciphertextB64: CIPHERTEXT_B64,
      ivHex: IV_HEX,
      keyBytes: wrongKey,
    });
    expect(result.success).toBe(false);
  });

  it('fails when the decrypted plaintext is not a 32-byte hex key', () => {
    const keyBytes = deriveExchangeKey({ seed: SEED, salt: SALT, length: 32, padChar: 'a' });
    const iv = Buffer.from(IV_HEX, 'hex');
    const cipher = createCipheriv('aes-256-cbc', keyBytes, iv);
    const shortHexPlaintext = '0011';
    const ct = Buffer.concat([cipher.update(shortHexPlaintext, 'utf8'), cipher.final()]);
    const result = decryptExchangedHmacKey({
      ciphertextB64: ct.toString('base64'),
      ivHex: IV_HEX,
      keyBytes,
    });
    expect(result.success).toBe(false);
  });

  it('fails when the decrypted plaintext is not canonical hex', () => {
    const keyBytes = deriveExchangeKey({ seed: SEED, salt: SALT, length: 32, padChar: 'a' });
    const iv = Buffer.from(IV_HEX, 'hex');
    const cipher = createCipheriv('aes-256-cbc', keyBytes, iv);
    const oddLengthHexPlaintext = '001';
    const ct = Buffer.concat([cipher.update(oddLengthHexPlaintext, 'utf8'), cipher.final()]);
    const result = decryptExchangedHmacKey({
      ciphertextB64: ct.toString('base64'),
      ivHex: IV_HEX,
      keyBytes,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('canonical');
    }
  });
});
