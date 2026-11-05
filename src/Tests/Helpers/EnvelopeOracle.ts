/**
 * Independent AES-256-CBC oracle for the envelope codec (N39) tests: a fixed
 * synthetic key and IV, the ciphertexts openssl gave for them, and raw
 * encrypt/decrypt calls that bypass the codec under test.
 */

import { createCipheriv, createDecipheriv } from 'node:crypto';

/** Synthetic session key: bytes 0x00..0x1f. */
export const ENVELOPE_KEY = Buffer.from(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  'hex',
);

/** The session key as carry holds it. */
export const ENVELOPE_KEY_TEXT = ENVELOPE_KEY.toString('base64');

/** Synthetic IV: bytes 0xa0..0xaf. */
export const ENVELOPE_IV = Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeaf', 'hex');

/** The IV as the `encryption` header holds it. */
export const ENVELOPE_IV_TEXT = ENVELOPE_IV.toString('base64');

/** Synthetic crypto session id. */
export const ENVELOPE_SESSION_ID = 'syn-session-1';

/** One openssl golden: `openssl enc -aes-256-cbc -K <key> -iv <iv> -a`. */
export interface IEnvelopeGolden {
  readonly plain: string;
  readonly cipher: string;
}

/** Ciphertexts openssl 3 produced for the synthetic key and IV. */
export const OPENSSL_GOLDENS = {
  greeting: {
    plain: '{"r":"Hello Encrypted World"}',
    cipher: 'eTDc4Pt1/6uQIRiY/ZGShM4xalAsX+HPqfGbE70hSXQ=',
  },
  flowHeader: {
    plain: '{"type":"flow_id","flow_id":"F00D"}',
    cipher: 'W7Rkh7uOl/ew4oanZhFIQGzTMfjKSWSWSm7L41lRc7+bRE21R9zesURvBZkE6jvs',
  },
  hebrew: {
    plain: '{"note":"שלום"}',
    cipher: 'vqlMtV8QMZX006JMSSAbMvUDyqWKvMpQfgfZnHPOQdA=',
  },
} as const satisfies Readonly<Record<string, IEnvelopeGolden>>;

/**
 * Encrypt raw bytes under the synthetic key.
 * @param plain - Plaintext bytes or UTF-8 text.
 * @param iv - IV; the synthetic one when absent.
 * @returns Ciphertext, base64.
 */
export function aesSeal(plain: Buffer | string, iv: Buffer = ENVELOPE_IV): string {
  const cipher = createCipheriv('aes-256-cbc', ENVELOPE_KEY, iv);
  const head = cipher.update(plain);
  const tail = cipher.final();
  return Buffer.concat([head, tail]).toString('base64');
}

/**
 * Decrypt a base64 ciphertext under the synthetic key.
 * @param cipherText - Ciphertext, base64.
 * @param ivText - IV, base64.
 * @returns The plaintext as UTF-8 text.
 */
export function aesOpen(cipherText: string, ivText: string): string {
  const iv = Buffer.from(ivText, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', ENVELOPE_KEY, iv);
  const head = decipher.update(cipherText, 'base64');
  const tail = decipher.final();
  return Buffer.concat([head, tail]).toString('utf8');
}

/**
 * An answer sealed under the synthetic session, the way the bank seals one.
 * @param data - The answer's data record.
 * @param extraHeaders - Headers after the `encryption` header.
 * @returns The sealed answer.
 */
export function sealedAnswer(
  data: Readonly<Record<string, unknown>>,
  extraHeaders: readonly Readonly<Record<string, unknown>>[] = [],
): Record<string, unknown> {
  const header = {
    type: 'encryption',
    iv: ENVELOPE_IV_TEXT,
    crypto_session_id: ENVELOPE_SESSION_ID,
  };
  const plain = JSON.stringify(data);
  const sealed = aesSeal(plain);
  return { headers: [header, ...extraHeaders], data: sealed };
}
