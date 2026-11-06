/**
 * EcdhKeypair — the `ecdh-key` carry generator. It makes a fresh ECDH
 * key pair on the config's curve and returns two slots: the uncompressed
 * public point (65 bytes, 0x04 first) as base64 under `publicInto`, and the
 * private scalar, padded to 32 bytes, as base64 under `privateInto`.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createECDH, type ECDH } from 'node:crypto';

import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import type { IEcdhKeyGenerator } from '../ConfigContracts/index.js';
import type { GeneratedCarry } from './RsaKeyGenerator.js';

/** Byte length of a secp256k1 private scalar. */
const PRIVATE_KEY_BYTES = 32;

/**
 * The private scalar at its full length: `getPrivateKey` drops leading zeros.
 * @param ecdh - ECDH holding a private key.
 * @returns The scalar, left-padded with zeros to 32 bytes.
 */
function paddedPrivateKey(ecdh: ECDH): Buffer {
  const scalar = ecdh.getPrivateKey();
  const padding = Buffer.alloc(PRIVATE_KEY_BYTES - scalar.length);
  return Buffer.concat([padding, scalar]);
}

/**
 * Make a fresh ECDH key pair and write both slots.
 * @param generator - Generator config.
 * @returns Procedure with the public point and the private scalar, base64.
 */
function generateEcdhKey(generator: IEcdhKeyGenerator): Promise<Procedure<GeneratedCarry>> {
  const ecdh = createECDH(generator.curve);
  const publicKey = ecdh.generateKeys('base64');
  const scalar = paddedPrivateKey(ecdh);
  const privateKey = scalar.toString('base64');
  const slots = { [generator.publicInto]: publicKey, [generator.privateInto]: privateKey };
  const made = succeed(slots);
  return Promise.resolve(made);
}

export { generateEcdhKey, paddedPrivateKey };
