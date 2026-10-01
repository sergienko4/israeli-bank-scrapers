/**
 * Unit tests for CryptoKeyFactory — generic asymmetric-keypair
 * generator dispatched by SignerAlgorithm. Zero bank knowledge.
 */

import type { KeyObject } from 'node:crypto';
import { generateKeyPairSync } from 'node:crypto';

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { AsymmetricSignerAlgorithm } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/SignerTypes.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import {
  exportEcP256Pkcs8,
  generateKeypair,
  importEcP256Pkcs8,
  isKeypairFor,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import type { IKeyKind } from './KeyKindFixtures.js';
import { KEY_KINDS } from './KeyKindFixtures.js';

/** The only failure text the importer may emit — it names no key material. */
const IMPORT_FAILURE = 'persisted EC key invalid';
/** The only failure text the exporter may emit — it names no key material. */
const EXPORT_FAILURE = 'EC key export invalid';

/**
 * Export a P-256 keypair as PKCS#8 Base64 via the production path.
 * @returns Generated keypair and its exported private key text.
 */
function makeExportedP256(): { keyIdHex: string; publicKeyBase64: string; pkcs8: string } {
  const result = generateKeypair('ECDSA-P256');
  if (!result.success) throw new ScraperError('P-256 keypair generation should succeed');
  const exported = exportEcP256Pkcs8(result.value);
  if (!exported.success) throw new ScraperError('P-256 key export should succeed');
  const { keyIdHex, publicKeyBase64 } = result.value;
  return { keyIdHex, publicKeyBase64, pkcs8: exported.value };
}

/**
 * Check the writer/reader contract for one keypair: whatever the exporter
 * writes, the importer must read back as the same public key and key ID.
 * @param keypair - Keypair handed to the exporter.
 * @returns False only when the exporter wrote text the importer cannot restore.
 */
function isExportReadable(keypair: IGenericKeypair): boolean {
  const exported = exportEcP256Pkcs8(keypair);
  if (!exported.success) return true;
  const imported = importEcP256Pkcs8(exported.value);
  if (!imported.success) return false;
  const isSameKeyId = imported.value.keyIdHex === keypair.keyIdHex;
  return isSameKeyId && imported.value.publicKeyBase64 === keypair.publicKeyBase64;
}

/** Key kinds the exporter must refuse — everything not sound for P-256. */
const NON_P256_KINDS: readonly IKeyKind[] = KEY_KINDS.filter(
  kind => kind.soundFor !== 'ECDSA-P256',
);

/**
 * Encode a private key as PKCS#8 DER in standard Base64.
 * @param privateKey - Any Node private key.
 * @returns PKCS#8 DER as standard Base64.
 */
function pkcs8Of(privateKey: KeyObject): string {
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  return der.toString('base64');
}

const RSA_PAIR = generateKeyPairSync('rsa', { modulusLength: 2048 });
const P384_PAIR = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
const ED25519_PAIR = generateKeyPairSync('ed25519');
/** A valid key's text, used to prove the canonical-Base64 check in isolation. */
const EXPORTED_PKCS8 = makeExportedP256().pkcs8;

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

describe('CryptoKeyFactory.importEcP256Pkcs8 — persisted device key', () => {
  it('rehydrates the same public key and key ID that generation produced', () => {
    const original = makeExportedP256();
    const imported = importEcP256Pkcs8(original.pkcs8);
    if (!imported.success) throw new ScraperError('exported P-256 key should import');
    expect(imported.value.keyIdHex).toBe(original.keyIdHex);
    expect(imported.value.publicKeyBase64).toBe(original.publicKeyBase64);
  });

  it('exports canonical padded standard Base64', () => {
    const { pkcs8 } = makeExportedP256();
    const reEncoded = Buffer.from(pkcs8, 'base64').toString('base64');
    expect(reEncoded).toBe(pkcs8);
  });

  it.each([
    ['empty text', ''],
    ['non-Base64 text', 'not base64!'],
    ['extra trailing padding', `${EXPORTED_PKCS8}==`],
    ['an embedded newline', `${EXPORTED_PKCS8.slice(0, 40)}\n${EXPORTED_PKCS8.slice(40)}`],
    ['bytes that are not PKCS#8', Buffer.from('not a key', 'utf8').toString('base64')],
    ['an RSA key', pkcs8Of(RSA_PAIR.privateKey)],
    ['a P-384 key', pkcs8Of(P384_PAIR.privateKey)],
    ['an Ed25519 key', pkcs8Of(ED25519_PAIR.privateKey)],
    [
      'an SPKI public key',
      ED25519_PAIR.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    ],
  ])('rejects %s without echoing it', (_label, text) => {
    const result = importEcP256Pkcs8(text);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe(IMPORT_FAILURE);
  });
});

describe('CryptoKeyFactory.exportEcP256Pkcs8 — writes only what the importer reads', () => {
  const acceptanceCases = KEY_KINDS.map(kind => [kind.label, kind] as const);

  it.each(acceptanceCases)('%s → export succeeds only for a sound P-256 key', (_label, kind) => {
    const result = exportEcP256Pkcs8(kind.keypair);
    expect(result.success).toBe(kind.soundFor === 'ECDSA-P256');
  });

  it.each(acceptanceCases)('%s → whatever is exported imports back intact', (_label, kind) => {
    const isReadable = isExportReadable(kind.keypair);
    expect(isReadable).toBe(true);
  });

  const refusalCases = NON_P256_KINDS.map(kind => [kind.label, kind] as const);

  it.each(refusalCases)('%s → refused without echoing key material', (_label, kind) => {
    const result = exportEcP256Pkcs8(kind.keypair);
    if (result.success) throw new ScraperError(`${kind.label} export should fail`);
    expect(result.errorMessage).toBe(EXPORT_FAILURE);
  });
});

/** Every asymmetric algorithm a keypair can be checked against. */
const ALGORITHMS: readonly AsymmetricSignerAlgorithm[] = ['ECDSA-P256', 'RSA-2048'];

describe('CryptoKeyFactory.isKeypairFor — caller-supplied keypairs', () => {
  const cases = KEY_KINDS.flatMap(kind =>
    ALGORITHMS.map(algorithm => [kind.label, algorithm, kind.soundFor === algorithm] as const),
  );

  it.each(cases)('%s as %s → accepted: %s', (label, algorithm, expected) => {
    const kind = KEY_KINDS.find(candidate => candidate.label === label);
    if (kind === undefined) throw new ScraperError(`unknown key kind ${label}`);
    const isAccepted = isKeypairFor(kind.keypair, algorithm);
    expect(isAccepted).toBe(expected);
  });

  it('accepts what the generator and the importer produce', () => {
    const exported = makeExportedP256();
    const imported = importEcP256Pkcs8(exported.pkcs8);
    if (!imported.success) throw new ScraperError('exported P-256 key should import');
    const isAccepted = isKeypairFor(imported.value, 'ECDSA-P256');
    expect(isAccepted).toBe(true);
  });
});
