/**
 * Unit tests for CryptoKeyFactory — generic asymmetric-keypair
 * generator dispatched by SignerAlgorithm. Zero bank knowledge.
 */

import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';

describe('CryptoKeyFactory.generateKeypair — ECDSA-P256', () => {
  it('returns a keypair with private + public DER + base64 + key-id', () => {
    const result = generateKeypair('ECDSA-P256');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.privateKey).toBeDefined();
      expect(result.value.publicKeyDer.length).toBeGreaterThan(0);
      expect(result.value.publicKeyBase64.length).toBeGreaterThan(0);
      expect(result.value.keyIdHex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('produces a different key on each call', () => {
    const a = generateKeypair('ECDSA-P256');
    const b = generateKeypair('ECDSA-P256');
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (a.success && b.success) expect(a.value.keyIdHex).not.toBe(b.value.keyIdHex);
  });
});

describe('CryptoKeyFactory.generateKeypair — RSA-2048', () => {
  it('returns a keypair with a 2048-bit modulus (DER ≥ 270 bytes)', () => {
    const result = generateKeypair('RSA-2048');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.publicKeyDer.length).toBeGreaterThanOrEqual(270);
      expect(result.value.keyIdHex).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('CryptoKeyFactory.generateKeypair — unsupported algorithm', () => {
  it('returns Procedure.fail for an unknown algorithm tag', () => {
    const tag = 'ED25519' as unknown as 'ECDSA-P256';
    const result = generateKeypair(tag);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unsupported signer algorithm');
  });
});
