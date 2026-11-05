/**
 * RsaKeyGenerator — the `rsa-key` carry generator (N25a). It makes a fresh
 * RSA key pair and returns the slots its config names: the PKCS#8 PEM private
 * key under `keyInto`, and the lowercase hex SHA-256 of the public key's SPKI
 * DER under `spkiSha256HexInto`.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createHash, generateKeyPair, type KeyObject } from 'node:crypto';
import { promisify } from 'node:util';

import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import type { IRsaKeyGenerator } from '../ConfigContracts/index.js';

/** Carry slots one generator wrote. */
type GeneratedCarry = Readonly<Record<string, string>>;

const GENERATE_KEY_PAIR = promisify(generateKeyPair);

/**
 * Lowercase hex SHA-256 of a public key's SPKI DER.
 * @param publicKey - Public key.
 * @returns 64 hex characters.
 */
function spkiSha256Hex(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const hash = createHash('sha256').update(der);
  return hash.digest('hex');
}

/**
 * The private-key slot, when the config names one.
 * @param generator - Generator config.
 * @param privateKey - Fresh private key.
 * @returns The PKCS#8 PEM under `keyInto`, or no slot.
 */
function keySlot(generator: IRsaKeyGenerator, privateKey: KeyObject): GeneratedCarry {
  if (generator.keyInto === undefined) return {};
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { [generator.keyInto]: pem };
}

/**
 * The SPKI-hash slot, when the config names one.
 * @param generator - Generator config.
 * @param publicKey - Fresh public key.
 * @returns The SPKI SHA-256 hex under `spkiSha256HexInto`, or no slot.
 */
function hashSlot(generator: IRsaKeyGenerator, publicKey: KeyObject): GeneratedCarry {
  if (generator.spkiSha256HexInto === undefined) return {};
  const hex = spkiSha256Hex(publicKey);
  return { [generator.spkiSha256HexInto]: hex };
}

/**
 * Make a fresh RSA key pair and the slots the config names.
 * @param generator - Generator config.
 * @returns Procedure with the generated slots; rejects when key generation fails.
 */
async function generateRsaKey(generator: IRsaKeyGenerator): Promise<Procedure<GeneratedCarry>> {
  const pair = await GENERATE_KEY_PAIR('rsa', { modulusLength: generator.bits });
  const key = keySlot(generator, pair.privateKey);
  const hash = hashSlot(generator, pair.publicKey);
  return succeed({ ...key, ...hash });
}

export type { GeneratedCarry };
export { generateRsaKey, spkiSha256Hex };
