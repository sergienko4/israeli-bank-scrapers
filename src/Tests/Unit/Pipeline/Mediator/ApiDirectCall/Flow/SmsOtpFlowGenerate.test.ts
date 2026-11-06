/**
 * A step's `rsa-key` generator makes a fresh 2048-bit RSA key once
 * the step's `runIf` guard passes and before its body is hydrated. It writes
 * the PKCS#8 PEM to `keyInto` and the lowercase hex SHA-256 of the SPKI DER
 * to `spkiSha256HexInto`. A skipped step generates nothing; a generator that
 * fails fails the step `<step> generate <kind> failed` before any request.
 * An `ecdh-key` generator writes a secp256k1 pair the same way.
 */

import { createECDH, createPrivateKey, createPublicKey } from 'node:crypto';

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  ICarryGenerator,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { spkiSha256Hex } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/RsaKeyGenerator.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { WARM_STEP_TAG } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const STEP_URL = 'https://bank.example/connect/device/register';

/** A test-only RSA public key; its golden comes from `openssl dgst -sha256` over the SPKI DER. */
const FIXED_PUBLIC_PEM = [
  '-----BEGIN PUBLIC KEY-----',
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnQwhkUYWaxtF7GvVxAgB',
  'n+ibAb9GaKMlWoo0AmQ4tjBSH8usiJnrJFZdIqG65QhbVm7xDBlt3Nm2xs/T1J0I',
  '80fxa9uTib7U4WlvhQoMKBhFJlR5Jq1iiQkLx9jcoGBI6kMu4kxbc2Hj7t6Gr4gA',
  'VLjcVBk5v7eVEWjZksKyNFkRRJTQrsTKSmmTXDdDcO7xFikUdVbm3uu8kEmnDyZm',
  'hhEEjbNLqYO52+4fbt0nGQ5e8+fHALVeiIAPgxYGo4weRuqD/gRzKACUlyKls9Wo',
  '0Wm1OiiMXhzeMHsB6fUC5V6HjZ8+9bO3W5AgOp8F9wxfpFUviI5BXsazBJz+LagK',
  '8wIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');
const FIXED_SPKI_SHA256 = '49ba5a804e98e8638b9d3717be0c0a47965cdd8f041e88ac6b0e1908878d35b4';

const RSA_KEY: ICarryGenerator = {
  kind: 'rsa-key',
  bits: 2048,
  keyInto: 'certKeyPem',
  spkiSha256HexInto: 'deviceId',
};

/** The public point goes to the slot the register body sends. */
const ECDH_KEY: ICarryGenerator = {
  kind: 'ecdh-key',
  curve: 'secp256k1',
  publicInto: 'deviceId',
  privateInto: 'ecdhPrivate',
};

/** The bind step: reads the bank's `state`. */
const BIND_STEP: IStepConfig = {
  name: 'bind',
  urlTag: WARM_STEP_TAG,
  body: { shape: {} },
  extractsToCarry: { token: '/token' },
  optionalExtractsToCarry: { state: { pointer: '/state' } },
};

/**
 * The register step, generating with the given generator.
 * @param generator - The step's one generator.
 * @returns Step config whose body sends the generated device id.
 */
function registerStep(generator: ICarryGenerator): IStepConfig {
  return {
    name: 'register',
    urlTag: WARM_STEP_TAG,
    generate: [generator],
    body: { shape: { deviceId: { $ref: 'carry.deviceId' } } },
    extractsToCarry: { token: '/token' },
    runIf: { carry: 'state', oneOf: ['register'] },
  };
}

/** What one run of the two-step flow did. */
interface IRunTrace {
  readonly result: Awaited<ReturnType<typeof runSmsOtpFlow>>;
  readonly captures: IApiPostCapture[];
}

/**
 * Run bind then register.
 * @param state - The `state` the bind step answers.
 * @param generator - The register step's generator.
 * @returns The flow result and the requests sent.
 */
async function runWith(state: string, generator: ICarryGenerator = RSA_KEY): Promise<IRunTrace> {
  const captures: IApiPostCapture[] = [];
  const bindAnswer: JsonValue = { token: 'bind-token', state };
  const responses = [succeed(bindAnswer), succeed({ token: 'register-token' })];
  const bus = makeStubMediator({ responses, captures });
  const step = registerStep(generator);
  const config: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [BIND_STEP, step] };
  const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
  return { result, captures };
}

describe('SmsOtpFlow — rsa-key generator', () => {
  beforeAll((): void => {
    registerWkUrl(WARM_STEP_TAG, HINT, STEP_URL);
  });

  it('hashes the SPKI DER of a fixed key to its golden', () => {
    const publicKey = createPublicKey(FIXED_PUBLIC_PEM);
    const hex = spkiSha256Hex(publicKey);
    expect(hex).toBe(FIXED_SPKI_SHA256);
  });

  it('writes a 2048-bit PKCS#8 key and its SPKI hash before the body is hydrated', async () => {
    const run = await runWith('register');
    if (!run.result.success) throw new TypeError(run.result.errorMessage);
    const carry = run.result.value.carrySnapshot;
    const pem = carry.certKeyPem as string;
    expect(pem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    const privateKey = createPrivateKey(pem);
    expect(privateKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    const publicKey = createPublicKey(privateKey);
    const expected = spkiSha256Hex(publicKey);
    expect(carry.deviceId).toBe(expected);
    expect(expected).toMatch(/^[\da-f]{64}$/);
    expect(run.captures[1].body).toEqual({ deviceId: expected });
  });

  it('writes an ecdh-key pair and sends the public point, never the private', async () => {
    const run = await runWith('register', ECDH_KEY);
    if (!run.result.success) throw new TypeError(run.result.errorMessage);
    const carry = run.result.value.carrySnapshot;
    const ecdh = createECDH('secp256k1');
    const scalar = Buffer.from(carry.ecdhPrivate as string, 'base64');
    ecdh.setPrivateKey(scalar);
    const expected = ecdh.getPublicKey('base64');
    expect(run.captures[1].body).toEqual({ deviceId: expected });
  });

  it('fails the step before a request when ECDH creation throws', async () => {
    const broken = { ...ECDH_KEY, curve: 'unsupported' } as unknown as ICarryGenerator;
    const run = await runWith('register', broken);
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'register generate ecdh-key failed',
    });
    expect(run.captures).toHaveLength(1);
  });

  it('generates nothing for a step its runIf guard skips', async () => {
    const run = await runWith('landpage');
    if (!run.result.success) throw new TypeError(run.result.errorMessage);
    expect(run.captures).toHaveLength(1);
    expect(run.result.value.carrySnapshot).not.toHaveProperty('certKeyPem');
    expect(run.result.value.carrySnapshot).not.toHaveProperty('deviceId');
  });

  it('fails the step before any request when the generator fails', async () => {
    const broken = { ...RSA_KEY, bits: 1 } as unknown as ICarryGenerator;
    const run = await runWith('register', broken);
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'register generate rsa-key failed',
    });
    expect(run.captures).toHaveLength(1);
  });
});
