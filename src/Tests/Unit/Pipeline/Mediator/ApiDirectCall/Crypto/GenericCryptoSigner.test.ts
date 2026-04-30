/**
 * Unit tests for GenericCryptoSigner — signs pre-built canonical
 * bytes with a configured algorithm/encoding and assembles the
 * outbound header value per ISignerConfig. Zero bank knowledge.
 */

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { signCanonical } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/GenericCryptoSigner.js';
import type {
  ICanonicalStringConfig,
  ISignerConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** Minimal canonical config satisfying the new ISignerConfig requirement. */
const CANONICAL_STUB: ICanonicalStringConfig = {
  parts: ['bodyJson'],
  separator: '%%',
  escapeFrom: '%%',
  escapeTo: String.raw`\%`,
  sortQueryParams: false,
  clientVersion: '1.0.0',
};

/** Reusable signer config matching Pepper's Content-Signature shape. */
const ECDSA_DER_CONFIG: ISignerConfig = {
  algorithm: 'ECDSA-P256',
  encoding: 'DER',
  headerName: 'Content-Signature',
  schemeTag: 4,
  canonical: CANONICAL_STUB,
};

describe('GenericCryptoSigner.signCanonical — ECDSA-P256 + DER', () => {
  it('produces a header containing data, key-id, and scheme', () => {
    const keypair = generateKeypair('ECDSA-P256');
    expect(keypair.success).toBe(true);
    if (!keypair.success) throw new ScraperError('keypair generation should succeed');
    const bytes = Buffer.from('hello-world', 'utf8');
    const result = signCanonical(bytes, keypair.value, ECDSA_DER_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toContain('data:');
      expect(result.value).toContain(`key-id:${keypair.value.keyIdHex}`);
      expect(result.value).toContain('scheme:4');
    }
  });

  it('embeds the configured headerName via the caller', () => {
    const keypair = generateKeypair('ECDSA-P256');
    if (!keypair.success) throw new ScraperError('keypair generation should succeed');
    const bytes = Buffer.from('payload', 'utf8');
    const result = signCanonical(bytes, keypair.value, ECDSA_DER_CONFIG);
    expect(result.success).toBe(true);
    // headerName is an ISignerConfig field — caller writes it; test
    // verifies the value is non-empty so caller can attach it.
    if (result.success) expect(result.value.length).toBeGreaterThan(0);
  });
});

describe('GenericCryptoSigner.signCanonical — RSA-2048 + JOSE', () => {
  it('produces a base64 signature with rsa keypair', () => {
    const keypair = generateKeypair('RSA-2048');
    if (!keypair.success) throw new ScraperError('keypair generation should succeed');
    const bytes = Buffer.from('rsa-payload', 'utf8');
    const config: ISignerConfig = {
      algorithm: 'RSA-2048',
      encoding: 'JOSE',
      headerName: 'X-Sig',
      schemeTag: 1,
      canonical: CANONICAL_STUB,
    };
    const result = signCanonical(bytes, keypair.value, config);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toContain('scheme:1');
  });
});

describe('GenericCryptoSigner.signCanonical — unsupported encoding', () => {
  it('returns Procedure.fail when encoding is unknown', () => {
    const keypair = generateKeypair('ECDSA-P256');
    if (!keypair.success) throw new ScraperError('keypair generation should succeed');
    const bytes = Buffer.from('payload', 'utf8');
    const badEncoding = 'PGP' as unknown as 'DER';
    const config: ISignerConfig = {
      algorithm: 'ECDSA-P256',
      encoding: badEncoding,
      headerName: 'X-Sig',
      schemeTag: 1,
      canonical: CANONICAL_STUB,
    };
    const result = signCanonical(bytes, keypair.value, config);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unsupported signer encoding');
  });
});
