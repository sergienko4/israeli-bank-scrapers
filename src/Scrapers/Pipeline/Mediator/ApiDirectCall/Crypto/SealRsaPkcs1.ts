/**
 * SealRsaPkcs1 — the `rsa-pkcs1-v15` credential seal (N44). The bank's RSA
 * public key arrives as PEM or as base64 SPKI DER (whitespace ignored); each
 * source is encoded as latin1, encrypted alone under PKCS#1 v1.5 padding and
 * sent as standard base64. A fresh random padding makes every seal differ.
 * Failures name no value: `seal key invalid`, `seal source invalid` (absent,
 * empty or too long for the key) or `seal unencodable`. Pure Node crypto.
 */

import type { KeyObject } from 'node:crypto';
import { constants, createPublicKey, publicEncrypt } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { ISealedFieldTarget, ISealRsaPkcs1Config } from '../ConfigContracts/index.js';
import type { ISealedWrite, SealPlan, SealRef, SealRefText } from './SealPlan.js';
import { SOURCE_INVALID } from './SealTail.js';

const PEM_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----';
const PEM_RSA_PUBLIC_KEY = '-----BEGIN RSA PUBLIC KEY-----';
const MAX_KEY_CHARS = 16_384;
const KEY_INVALID = 'seal key invalid';
const UNENCODABLE = 'seal unencodable';

/**
 * Parse a key text: a PEM public key, or canonical base64 of SPKI DER.
 * @param keyText - Key text from carry.
 * @returns The key, or false when the text holds none.
 */
function parsedKey(keyText: string): KeyObject | false {
  const isPem = keyText.includes(PEM_PUBLIC_KEY) || keyText.includes(PEM_RSA_PUBLIC_KEY);
  if (isPem) return createPublicKey(keyText);
  const compact = keyText.replaceAll(/\s/gu, '');
  const der = Buffer.from(compact, 'base64');
  if (der.length === 0 || der.toString('base64') !== compact) return false;
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * Parse a key text, treating a parser refusal as no key.
 * @param keyText - Key text from carry.
 * @returns The key, or false.
 */
function tryParsedKey(keyText: string): KeyObject | false {
  try {
    return parsedKey(keyText);
  } catch {
    return false;
  }
}

/**
 * Import the RSA public key a seal encrypts under.
 * @param keyText - Key text from carry.
 * @returns The key, or `seal key invalid` for any other text or key type.
 */
function importSealKey(keyText: string): Procedure<KeyObject> {
  if (keyText.length > MAX_KEY_CHARS) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  const key = tryParsedKey(keyText);
  if (key === false || key.asymmetricKeyType !== 'rsa') {
    return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  }
  return succeed(key);
}

/**
 * Whether every character of a text has a latin1 byte.
 * @param source - Credential text.
 * @returns True when no character is above U+00FF.
 */
function isLatin1(source: string): boolean {
  return Buffer.from(source, 'latin1').toString('latin1') === source;
}

/**
 * Encrypt latin1 bytes under PKCS#1 v1.5 padding.
 * @param key - RSA public key.
 * @param plain - Source bytes.
 * @returns Base64 ciphertext, or false when the bytes do not fit the key.
 */
function tryEncrypt(key: KeyObject, plain: Buffer): string | false {
  try {
    const sealed = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, plain);
    return sealed.toString('base64');
  } catch {
    return false;
  }
}

/**
 * Seal one source under the key.
 * @param key - RSA public key.
 * @param source - Credential text.
 * @returns Base64 ciphertext; `seal unencodable` when a character is above
 *   U+00FF, `seal source invalid` when empty or too long for the key.
 */
function sealRsaPkcs1(key: KeyObject, source: string): Procedure<string> {
  if (source.length === 0) return fail(ScraperErrorTypes.Generic, SOURCE_INVALID);
  if (!isLatin1(source)) return fail(ScraperErrorTypes.Generic, UNENCODABLE);
  const plain = Buffer.from(source, 'latin1');
  const sealed = tryEncrypt(key, plain);
  if (sealed === false) return fail(ScraperErrorTypes.Generic, SOURCE_INVALID);
  return succeed(sealed);
}

/** What sealing each field shares: the imported key and the ref reader. */
interface IFieldSealing {
  readonly key: KeyObject;
  readonly refText: SealRefText;
}

/**
 * Seal one field's source and pair it with its pointer.
 * @param field - Source ref and body pointer.
 * @param sealing - Key and ref reader.
 * @returns The planned write, or a failure that names no value.
 */
function sealField(field: ISealedFieldTarget, sealing: IFieldSealing): Procedure<ISealedWrite> {
  const source = sealing.refText(field.sourceRef);
  if (source === false) return fail(ScraperErrorTypes.Generic, SOURCE_INVALID);
  const sealed = sealRsaPkcs1(sealing.key, source);
  if (!isOk(sealed)) return sealed;
  return succeed({ writeTo: field.writeTo, value: sealed.value });
}

/**
 * Add one field's write to the plan, stopping at the first failure.
 * @param plan - Writes so far.
 * @param field - Next field.
 * @param sealing - Key and ref reader.
 * @returns The longer plan, or the first failure.
 */
function nextPlan(plan: SealPlan, field: ISealedFieldTarget, sealing: IFieldSealing): SealPlan {
  if (!isOk(plan)) return plan;
  const write = sealField(field, sealing);
  if (!isOk(write)) return write;
  return succeed([...plan.value, write.value]);
}

/**
 * Import the key a carry ref holds.
 * @param keyRef - Carry ref of the key text.
 * @param refText - Ref reader.
 * @returns The key, or `seal key invalid`.
 */
function importRefKey(keyRef: SealRef, refText: SealRefText): Procedure<KeyObject> {
  const keyText = refText(keyRef);
  if (keyText === false) return fail(ScraperErrorTypes.Generic, KEY_INVALID);
  return importSealKey(keyText);
}

/**
 * Plan an `rsa-pkcs1-v15` seal: import the carry key, then seal each field.
 * @param seal - Seal config.
 * @param refText - Ref reader.
 * @returns One write per field, or the first failure.
 */
function planRsaPkcs1(seal: ISealRsaPkcs1Config, refText: SealRefText): SealPlan {
  const key = importRefKey(seal.keyRef, refText);
  if (!isOk(key)) return key;
  const sealing: IFieldSealing = { key: key.value, refText };
  const empty: SealPlan = succeed([]);
  return seal.fields.reduce<SealPlan>((plan, field) => nextPlan(plan, field, sealing), empty);
}

export { importSealKey, planRsaPkcs1, sealRsaPkcs1 };
