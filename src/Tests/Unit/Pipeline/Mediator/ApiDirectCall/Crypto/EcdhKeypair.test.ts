/**
 * The `ecdh-key` carry generator makes a fresh secp256k1 key pair: the
 * uncompressed public point (65 bytes, 0x04 first) as base64 into
 * `publicInto`, the 32-byte private scalar as base64 into `privateInto`.
 */

import { createECDH } from 'node:crypto';

import type { IEcdhKeyGenerator } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import generateEcdhKey from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/EcdhKeypair.js';

const ECDH_KEY: IEcdhKeyGenerator = {
  kind: 'ecdh-key',
  curve: 'secp256k1',
  publicInto: 'ecdhPublic',
  privateInto: 'ecdhPrivate',
};

/** The two slots one run wrote, decoded. */
interface IPairBytes {
  readonly publicKey: Buffer;
  readonly privateKey: Buffer;
  readonly publicText: string;
  readonly privateText: string;
}

/**
 * Run the generator once and decode both slots.
 * @returns The written texts and their bytes.
 */
async function generatePair(): Promise<IPairBytes> {
  const made = await generateEcdhKey(ECDH_KEY);
  if (!made.success) throw new TypeError(made.errorMessage);
  const publicText = made.value.ecdhPublic;
  const privateText = made.value.ecdhPrivate;
  const publicKey = Buffer.from(publicText, 'base64');
  const privateKey = Buffer.from(privateText, 'base64');
  return { publicKey, privateKey, publicText, privateText };
}

/**
 * The secp256k1 public point of a private scalar.
 * @param privateKey - Private scalar bytes.
 * @returns Uncompressed public point.
 */
function publicOf(privateKey: Buffer): Buffer {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);
  return ecdh.getPublicKey();
}

describe('generateEcdhKey', () => {
  it('writes exactly the two named slots', async () => {
    const made = await generateEcdhKey(ECDH_KEY);
    if (!made.success) throw new TypeError(made.errorMessage);
    const slots = Object.keys(made.value).sort();
    expect(slots).toEqual(['ecdhPrivate', 'ecdhPublic']);
  });

  it('writes a 65-byte uncompressed public point and a 32-byte private scalar', async () => {
    const pair = await generatePair();
    expect(pair.publicKey).toHaveLength(65);
    expect(pair.publicKey[0]).toBe(0x04);
    expect(pair.privateKey).toHaveLength(32);
  });

  it('writes canonical base64', async () => {
    const pair = await generatePair();
    const publicCanonical = pair.publicKey.toString('base64');
    const privateCanonical = pair.privateKey.toString('base64');
    expect(pair.publicText).toBe(publicCanonical);
    expect(pair.privateText).toBe(privateCanonical);
  });

  it('writes a private scalar whose secp256k1 point is the public slot', async () => {
    const pair = await generatePair();
    const derived = publicOf(pair.privateKey);
    expect(derived).toEqual(pair.publicKey);
  });

  it('makes a fresh pair on every run', async () => {
    const first = await generatePair();
    const second = await generatePair();
    expect(first.privateText).not.toBe(second.privateText);
    expect(first.publicText).not.toBe(second.publicText);
  });
});
