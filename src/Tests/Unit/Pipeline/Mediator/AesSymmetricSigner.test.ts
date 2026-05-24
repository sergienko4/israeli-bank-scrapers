/**
 * Unit tests for AesSymmetricSigner — the AES-CBC-PKCS7 symmetric
 * sign primitive consumed by the AES variant of the GenericCryptoSigner
 * dispatch table.
 *
 * Test ordering: red-test-first per orientation.txt §3. This file
 * is added BEFORE the production module exists (task T1); the dynamic
 * import deferral keeps `tsc --noEmit` clean while letting Jest fail
 * at run time on the missing specifier. T4 implements the module and
 * brings these cases to green.
 *
 * Reference fixtures: spec.txt §10.1 + §10.2 (synthetic only).
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { signCanonicalDispatch } from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/GenericCryptoSigner.js';
import type {
  IAesSignerConfig,
  ICanonicalStringConfig,
} from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Args bundle for the AES sign primitive — respects 3-param ceiling. */
interface ISignAesArgs {
  readonly plaintext: string;
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
  readonly outputPostfix?: string;
}

/** Module-under-test shape resolved via dynamic import per red-test-first. */
interface IAesSignerModule {
  readonly signAesCbcPkcs7: (args: ISignAesArgs) => Procedure<string>;
}

/** Module specifier — resolved lazily so missing module fails Jest, not tsc. */
const MODULE_SPECIFIER =
  '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/AesSymmetricSigner.js';

/** Synthetic 32-byte AES-256 key (32 ASCII chars). Spec.txt §10.1. */
const FIXT_KEY_ASCII = '^492wkd#x12jk4%^SewAk56zx3@xdcf5';

/** Synthetic 32-hex IV — Buffer.from(hex, 'hex') yields 16 bytes. */
const FIXT_IV_HEX = '00112233445566778899aabbccddeeff';

/**
 * Lazily resolve the production module under test.
 * @returns The IAesSignerModule export bundle.
 */
async function loadModule(): Promise<IAesSignerModule> {
  const mod = (await import(MODULE_SPECIFIER)) as IAesSignerModule;
  return mod;
}

/** Args bundle for {@link expectedCipherBase64}. */
interface IExpectedCipherArgs {
  readonly plaintext: string;
  readonly keyUtf8: string;
  readonly ivHex: string;
}

/**
 * Compute the expected ciphertext base64 with a known-stable Node
 * createCipheriv call so the test guards a real cryptographic round
 * trip rather than a fixed string.
 * @param args - Inputs (plaintext + key + iv hex).
 * @returns Base64 ciphertext (no postfix).
 */
async function expectedCipherBase64(args: IExpectedCipherArgs): Promise<string> {
  const cryptoMod = await import('node:crypto');
  const key = Buffer.from(args.keyUtf8, 'utf8');
  const iv = Buffer.from(args.ivHex, 'hex');
  const cipher = cryptoMod.createCipheriv('aes-256-cbc', key, iv);
  const plaintextBuf = Buffer.from(args.plaintext, 'utf8');
  const part1 = cipher.update(plaintextBuf);
  const part2 = cipher.final();
  const ciphertext = Buffer.concat([part1, part2]);
  return ciphertext.toString('base64');
}

describe('AesSymmetricSigner.signAesCbcPkcs7 — basic sign', () => {
  it('UC-AES-1: produces expected base64 for known key/iv/plaintext', async () => {
    const mod = await loadModule();
    const canonical = '1700000000000|fixt-deviceid-pb-0001';
    const keyBytes = Buffer.from(FIXT_KEY_ASCII, 'utf8');
    const ivBytes = Buffer.from(FIXT_IV_HEX, 'hex');
    const result = mod.signAesCbcPkcs7({ plaintext: canonical, keyBytes, ivBytes });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('signAesCbcPkcs7 must succeed for known input');
    const expectedB64 = await expectedCipherBase64({
      plaintext: canonical,
      keyUtf8: FIXT_KEY_ASCII,
      ivHex: FIXT_IV_HEX,
    });
    expect(result.value).toBe(expectedB64);
  });
});

describe('AesSymmetricSigner.signAesCbcPkcs7 — trailing postfix', () => {
  it('UC-AES-2: appends configured postfix after the base64 ciphertext', async () => {
    const mod = await loadModule();
    const canonical = '1700000000000|fixt-deviceid-pb-0001';
    const keyBytes = Buffer.from(FIXT_KEY_ASCII, 'utf8');
    const ivBytes = Buffer.from(FIXT_IV_HEX, 'hex');
    const result = mod.signAesCbcPkcs7({
      plaintext: canonical,
      keyBytes,
      ivBytes,
      outputPostfix: '\n',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('signAesCbcPkcs7 must succeed for known input');
    const expectedB64 = await expectedCipherBase64({
      plaintext: canonical,
      keyUtf8: FIXT_KEY_ASCII,
      ivHex: FIXT_IV_HEX,
    });
    expect(result.value).toBe(`${expectedB64}\n`);
  });
});

describe('AesSymmetricSigner.signAesCbcPkcs7 — invalid key length', () => {
  it('UC-AES-3: returns Procedure.fail when key length is not 32 bytes', async () => {
    const mod = await loadModule();
    const canonical = 'whatever';
    const shortKey = Buffer.from('too-short', 'utf8');
    const ivBytes = Buffer.from(FIXT_IV_HEX, 'hex');
    const result = mod.signAesCbcPkcs7({ plaintext: canonical, keyBytes: shortKey, ivBytes });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('key');
    }
  });
});

/** Minimal canonical config satisfying ICanonicalStringConfig for AES. */
const CANONICAL_STUB: ICanonicalStringConfig = {
  parts: ['bodyJson'],
  separator: '|',
  escapeFrom: '|',
  escapeTo: String.raw`\|`,
  sortQueryParams: false,
  clientVersion: '1.0.0',
};

/** Reusable AES signer config for the dispatch case. */
const AES_CONFIG: IAesSignerConfig = {
  algorithm: 'AES-CBC-PKCS7',
  keyRef: 'config.signKey',
  ivStrategy: 'random-16',
  canonical: CANONICAL_STUB,
  bodySignatureField: '/signature',
  outputPostfix: '\n',
};

describe('AesSymmetricSigner.signAesCbcPkcs7 — invalid iv length', () => {
  it('UC-AES-3b: returns Procedure.fail when iv length is not 16 bytes', async () => {
    const mod = await loadModule();
    const canonical = 'whatever';
    const keyBytes = Buffer.from(FIXT_KEY_ASCII, 'utf8');
    const shortIv = Buffer.from('ff', 'hex');
    const result = mod.signAesCbcPkcs7({ plaintext: canonical, keyBytes, ivBytes: shortIv });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('iv');
    }
  });
});

describe('GenericCryptoSigner.signCanonicalDispatch — AES routing', () => {
  it('UC-AES-4: routes algorithm AES-CBC-PKCS7 to AesSymmetricSigner', async () => {
    const canonical = '1700000000000|fixt-deviceid-pb-0001';
    const canonicalBytes = Buffer.from(canonical, 'utf8');
    const keyBytes = Buffer.from(FIXT_KEY_ASCII, 'utf8');
    const ivBytes = Buffer.from(FIXT_IV_HEX, 'hex');
    const result = signCanonicalDispatch({
      canonical,
      canonicalBytes,
      config: AES_CONFIG,
      keyBytes,
      ivBytes,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('AES dispatch must succeed for valid args');
    const expectedB64 = await expectedCipherBase64({
      plaintext: canonical,
      keyUtf8: FIXT_KEY_ASCII,
      ivHex: FIXT_IV_HEX,
    });
    expect(result.value).toBe(`${expectedB64}\n`);
  });

  it('UC-AES-5: fails when AES dispatch lacks keyBytes/ivBytes', () => {
    const canonical = 'plaintext';
    const canonicalBytes = Buffer.from(canonical, 'utf8');
    const result = signCanonicalDispatch({
      canonical,
      canonicalBytes,
      config: AES_CONFIG,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('AES dispatch requires');
  });
});
