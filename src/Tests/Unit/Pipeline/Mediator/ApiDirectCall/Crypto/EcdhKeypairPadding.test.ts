/**
 * Deterministic coverage for the ECDH private-scalar padding: a 31-byte
 * scalar returned by `getPrivateKey` must be written as a zero-prefixed
 * 32-byte value, not left short.
 */

import type { ECDH } from 'node:crypto';

import { jest } from '@jest/globals';

import type { IEcdhKeyGenerator } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const ECDH_KEY: IEcdhKeyGenerator = {
  kind: 'ecdh-key',
  curve: 'secp256k1',
  publicInto: 'ecdhPublic',
  privateInto: 'ecdhPrivate',
};

/** Repeated byte of the controlled scalar. */
const SCALAR_HEX = '11'.repeat(31);
/** A 31-byte scalar whose 32-byte form needs one leading zero byte. */
const SCALAR_31 = Buffer.from(SCALAR_HEX, 'hex');
/** Uncompressed-point prefix. */
const POINT_PREFIX = Buffer.from([0x04]);
/** Fixed public-point body paired with the controlled scalar. */
const POINT_BODY = Buffer.alloc(64, 0x22);
/** Fixed uncompressed public point. */
const PUBLIC_65 = Buffer.concat([POINT_PREFIX, POINT_BODY]);

/**
 * Build an ECDH stub that reports the fixed scalar after key generation.
 * @returns The controlled ECDH handle.
 */
function controlledEcdh(): ECDH {
  return {
    /**
     * Return the fixed public point.
     * @returns Base64 uncompressed point.
     */
    generateKeys: (): string => PUBLIC_65.toString('base64'),
    /**
     * Return the 31-byte scalar.
     * @returns The fixed private scalar.
     */
    getPrivateKey: (): Buffer => SCALAR_31,
  } as unknown as ECDH;
}

jest.unstable_mockModule('node:crypto', () => ({
  /**
   * Return the controlled handle for any curve.
   * @returns The fixed ECDH stub.
   */
  createECDH: (): ECDH => controlledEcdh(),
}));

const ECDH_MODULE =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/EcdhKeypair.js');

describe('generateEcdhKey — leading-zero scalar', () => {
  it('pads a 31-byte private scalar to 32 bytes in the private slot', async () => {
    const made = await ECDH_MODULE.default(ECDH_KEY);
    if (!made.success) throw new TypeError(made.errorMessage);
    const publicText = PUBLIC_65.toString('base64');
    expect(made.value.ecdhPublic).toBe(publicText);
    const privateKey = Buffer.from(made.value.ecdhPrivate, 'base64');
    const expected = Buffer.concat([Buffer.from([0]), SCALAR_31]);
    expect(privateKey).toEqual(expected);
  });
});
