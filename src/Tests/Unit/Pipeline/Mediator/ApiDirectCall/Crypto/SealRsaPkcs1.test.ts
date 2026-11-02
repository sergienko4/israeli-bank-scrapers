/**
 * N44 — the `rsa-pkcs1-v15` seal: each source encoded as latin1 and RSA
 * PKCS#1 v1.5 encrypted alone under a public key that arrives as PEM or as
 * base64 SPKI DER, sent as standard base64. Failures name no value.
 */

import { generateKeyPairSync } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  importSealKey,
  sealRsaPkcs1,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/SealRsaPkcs1.js';
import { makePkcs1Key, openPkcs1 } from '../../../../../Helpers/SealOpener.js';

const KEY = makePkcs1Key();
const SOURCE = 'syn-Pass!7 é';
const STANDARD_BASE64 = /^[\d+/a-z]+={0,2}$/i;
const EC_PAIR = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const EC_PEM = EC_PAIR.publicKey.export({ type: 'spki', format: 'pem' });
const EC_DER = EC_PAIR.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

/**
 * Seal a source under a key text.
 * @param keyText - Key text, as carry holds it.
 * @param source - Credential text.
 * @returns The seal procedure.
 */
function sealUnder(keyText: string, source: string): ReturnType<typeof sealRsaPkcs1> {
  const key = importSealKey(keyText);
  if (!key.success) return key;
  return sealRsaPkcs1(key.value, source);
}

/**
 * Seal a source that must succeed.
 * @param keyText - Key text.
 * @param source - Credential text.
 * @returns The base64 seal.
 */
function sealedText(keyText: string, source: string): string {
  const result = sealUnder(keyText, source);
  if (!result.success) throw new TypeError(result.errorMessage);
  return result.value;
}

/**
 * A base64 DER key text wrapped at 64 columns with stray spaces.
 * @param derBase64 - Canonical base64.
 * @returns The wrapped text.
 */
function wrapped(derBase64: string): string {
  const lines = derBase64.match(/.{1,64}/g) ?? [];
  return ` ${lines.join('\r\n ')}\n`;
}

describe('N44 sealRsaPkcs1', () => {
  it('seals under a PEM key as standard base64 that opens to the latin1 source', () => {
    const sealed = sealedText(KEY.pem, SOURCE);
    const cipher = Buffer.from(sealed, 'base64');
    const opened = openPkcs1(KEY.privateKey, sealed);
    expect(sealed).toMatch(STANDARD_BASE64);
    expect(cipher).toHaveLength(128);
    expect(opened).toBe(SOURCE);
  });

  it.each([
    ['canonical', KEY.derBase64],
    ['wrapped', wrapped(KEY.derBase64)],
  ])('seals under a %s base64 SPKI DER key', (_label, keyText) => {
    const sealed = sealedText(keyText, SOURCE);
    const opened = openPkcs1(KEY.privateKey, sealed);
    expect(opened).toBe(SOURCE);
  });

  it('draws fresh padding, so two seals of one source differ', () => {
    const first = sealedText(KEY.pem, SOURCE);
    const second = sealedText(KEY.pem, SOURCE);
    expect(first).not.toBe(second);
  });

  it.each([
    ['an empty text', ''],
    ['plain words', 'not a key'],
    ['non-canonical base64', 'abc'],
    ['a PEM with a broken body', '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'],
    ['an EC PEM key', EC_PEM],
    ['an EC DER key', EC_DER],
    ['a text over 16384 characters', `${KEY.pem}${' '.repeat(16_384)}`],
  ])('refuses %s as "seal key invalid"', (_label, keyText) => {
    const result = importSealKey(keyText);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'seal key invalid',
    });
  });

  it.each([
    ['a Hebrew letter', 'syn-סיסמה'],
    ['an emoji', 'syn-🔑'],
  ])('refuses a source holding %s as "seal unencodable"', (_label, source) => {
    const result = sealUnder(KEY.pem, source);
    expect(result).toMatchObject({ success: false, errorMessage: 'seal unencodable' });
  });

  it.each([
    ['empty', ''],
    ['over the 117-byte room of a 1024-bit key', 'a'.repeat(118)],
  ])('refuses an %s source as "seal source invalid"', (_label, source) => {
    const result = sealUnder(KEY.pem, source);
    expect(result).toMatchObject({ success: false, errorMessage: 'seal source invalid' });
  });

  it('seals a source that fills the key room exactly', () => {
    const source = 'a'.repeat(117);
    const sealed = sealedText(KEY.pem, source);
    const opened = openPkcs1(KEY.privateKey, sealed);
    expect(opened).toBe(source);
  });

  it('keeps every failure free of the key and the source', () => {
    const results = [importSealKey('syn-secret-key'), sealUnder(KEY.pem, 'syn-סוד')];
    const text = JSON.stringify(results);
    expect(text).not.toContain('syn-secret-key');
    expect(text).not.toContain('סוד');
  });
});
