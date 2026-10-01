/**
 * Strict v1 durable-state codec (Task 3 of the Pepper durable-auth plan).
 *
 * The opaque state carries a bearer JWT and a device private key, so the codec
 * must reject anything malformed locally — before any auth request — and name
 * only a field category in its error text. Each negative row breaks exactly
 * one field of an otherwise-valid state, so its category proves which rule
 * fired.
 */

import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IGenericKeypair } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import {
  exportEcP256Pkcs8,
  generateKeypair,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import {
  decodePersistentAuthState,
  encodePersistentAuthState,
  type IPersistentAuthExpectation,
  type IPersistentAuthStateV1,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateCodec.js';
import { makeJwtExpiringIn, makeJwtWithClaims } from '../../../../Helpers/Jwt.js';

/** Neutral provider tag — the codec carries no bank knowledge. */
const PROVIDER = 'fixture-provider';
const ACCOUNT = '0501234567';
const EXPECTED: IPersistentAuthExpectation = { provider: PROVIDER, account: ACCOUNT };
const ERROR_PREFIX = 'persistent auth state invalid: ';
const ONE_HOUR_SECONDS = 3600;
/** The v1 contract's key order, as documented in the protocol reference. */
const V1_KEY_ORDER = [
  'version',
  'provider',
  'account',
  'clientInstanceId',
  'deviceId',
  'accessToken',
  'ecPrivateKeyPkcs8Base64',
];

/**
 * Generate a fresh P-256 keypair through the production factory.
 * @returns Keypair bundle.
 */
function makeEcKeypair(): IGenericKeypair {
  const result = generateKeypair('ECDSA-P256');
  if (!result.success) throw new ScraperError('P-256 keypair generation should succeed');
  return result.value;
}

/**
 * Export a keypair's private key through the production exporter.
 * @param keypair - Sound P-256 keypair.
 * @returns PKCS#8 DER as standard padded Base64.
 */
function exportedKeyOf(keypair: IGenericKeypair): string {
  const result = exportEcP256Pkcs8(keypair);
  if (!result.success) throw new ScraperError('P-256 key export should succeed');
  return result.value;
}

const KEYPAIR = makeEcKeypair();
const INSTANCE_ID = randomUUID();
const ACCESS_TOKEN = makeJwtExpiringIn(ONE_HOUR_SECONDS);
const VALID_STATE: IPersistentAuthStateV1 = {
  version: 1,
  provider: PROVIDER,
  account: ACCOUNT,
  clientInstanceId: INSTANCE_ID,
  deviceId: 'device-fixture-0001',
  accessToken: ACCESS_TOKEN,
  ecPrivateKeyPkcs8Base64: exportedKeyOf(KEYPAIR),
};

/**
 * Encode any JSON value the way a caller-supplied state would arrive,
 * bypassing the codec's own validation.
 * @param value - Value to serialise.
 * @returns Unpadded base64url of its JSON.
 */
function encodeRaw(value: unknown): string {
  const json = JSON.stringify(value);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Copy the valid state with one field replaced (or added).
 * @param field - Field name to set.
 * @param value - Replacement value.
 * @returns Raw state object.
 */
function withField(field: string, value: unknown): Readonly<Record<string, unknown>> {
  return { ...VALID_STATE, [field]: value };
}

/**
 * Decode and return the failure message, failing the test on success.
 * @param encoded - Opaque state.
 * @param expected - Expected provider and account.
 * @returns Failure message.
 */
function failureOf(encoded: string, expected: IPersistentAuthExpectation = EXPECTED): string {
  const result = decodePersistentAuthState(encoded, expected);
  if (result.success) throw new ScraperError('state should have been rejected');
  return result.errorMessage;
}

/**
 * Build a compact JWT with a numeric `exp` padded to an exact length.
 * @param length - Exact token length.
 * @returns Compact JWT of the requested length.
 */
function makeJwtOfLength(length: number): string {
  const jwt = makeJwtExpiringIn(ONE_HOUR_SECONDS);
  const headAndPayload = jwt.slice(0, jwt.lastIndexOf('.') + 1);
  const signature = 's'.repeat(length - headAndPayload.length);
  return `${headAndPayload}${signature}`;
}

/**
 * Export a non-P-256 private key as PKCS#8 Base64 to prove type/curve checks.
 * @param kind - Key family to generate.
 * @returns PKCS#8 DER as standard Base64.
 */
function foreignPkcs8(kind: 'rsa' | 'p384'): string {
  const pair =
    kind === 'rsa'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  const der = pair.privateKey.export({ type: 'pkcs8', format: 'der' });
  return der.toString('base64');
}

describe('PersistentAuthStateCodec — valid state', () => {
  it('round-trips and rehydrates the same public key and key ID', () => {
    const encoded = encodePersistentAuthState(VALID_STATE, EXPECTED);
    if (!encoded.success) throw new ScraperError('valid state should encode');
    const decoded = decodePersistentAuthState(encoded.value, EXPECTED);
    if (!decoded.success) throw new ScraperError('valid state should decode');
    expect(decoded.value.state).toEqual(VALID_STATE);
    expect(decoded.value.ecKeypair.keyIdHex).toBe(KEYPAIR.keyIdHex);
    expect(decoded.value.ecKeypair.publicKeyBase64).toBe(KEYPAIR.publicKeyBase64);
  });

  it('publishes unpadded base64url with exactly the v1 keys in contract order', () => {
    const withExtra = { ...VALID_STATE, extra: 'dropped' } as IPersistentAuthStateV1;
    const encoded = encodePersistentAuthState(withExtra, EXPECTED);
    if (!encoded.success) throw new ScraperError('state should encode');
    expect(encoded.value).toMatch(/^[\w-]+$/);
    const json = Buffer.from(encoded.value, 'base64url').toString('utf8');
    const keys = Object.keys(JSON.parse(json) as object);
    expect(keys).toEqual(V1_KEY_ORDER);
  });

  it('accepts an expired access token, which is what renewal starts from', () => {
    const staleToken = makeJwtExpiringIn(-ONE_HOUR_SECONDS);
    const raw = withField('accessToken', staleToken);
    const encoded = encodeRaw(raw);
    const decoded = decodePersistentAuthState(encoded, EXPECTED);
    expect(decoded.success).toBe(true);
  });

  it('rehydrates a key whose signatures verify against the original public key', () => {
    const encoded = encodeRaw(VALID_STATE);
    const decoded = decodePersistentAuthState(encoded, EXPECTED);
    if (!decoded.success) throw new ScraperError('valid state should decode');
    const data = Buffer.from('/api/v2/auth/login%%1.0.0%%{}', 'utf8');
    const signature = sign('sha256', data, decoded.value.ecKeypair.privateKey);
    const publicKey = { key: KEYPAIR.publicKeyDer, format: 'der', type: 'spki' } as const;
    const isVerified = verify('sha256', data, publicKey, signature);
    expect(isVerified).toBe(true);
  });

  it.each([
    ['account at 32 chars', 'account', '1'.repeat(32)],
    ['deviceId at 256 chars', 'deviceId', 'd'.repeat(256)],
    ['accessToken at 16384 chars', 'accessToken', makeJwtOfLength(16_384)],
  ])('accepts %s (upper bound)', (_label, field, value) => {
    const raw = withField(field, value);
    const account = field === 'account' ? value : ACCOUNT;
    const encoded = encodeRaw(raw);
    const decoded = decodePersistentAuthState(encoded, { provider: PROVIDER, account });
    expect(decoded.success).toBe(true);
  });
});

/**
 * Encode an otherwise-valid state with the standard Base64 alphabet, unpadded.
 * A run of `?` (0x3F) guarantees an aligned triple, which encodes to `Pz8/`.
 * @returns Standard-alphabet encoding containing `/`.
 */
function encodeStandardAlphabet(): string {
  const questionMarks = '?'.repeat(12);
  const raw = withField('deviceId', questionMarks);
  const json = JSON.stringify(raw);
  const padded = Buffer.from(json, 'utf8').toString('base64');
  return padded.replace(/=+$/, '');
}

describe('PersistentAuthStateCodec — envelope and JSON failures', () => {
  const standardAlphabet = encodeStandardAlphabet();

  it('precondition: the standard-alphabet fixture really contains + or /', () => {
    expect(standardAlphabet).toMatch(/[+/]/);
  });

  it.each([
    ['empty input', '', 'encoding'],
    ['over the 32 KiB cap', 'A'.repeat(32_772), 'encoding'],
    ['at the 32 KiB cap (reaches JSON parsing)', 'A'.repeat(32_768), 'json'],
    ['trailing padding', `${encodeRaw(VALID_STATE)}=`, 'encoding'],
    ['embedded newline', `${encodeRaw(VALID_STATE)}\n`, 'encoding'],
    ['standard Base64 alphabet', standardAlphabet, 'encoding'],
    ['invalid UTF-8', Buffer.from([0x7b, 0xff, 0x7d]).toString('base64url'), 'encoding'],
    ['non-JSON text', Buffer.from('not json', 'utf8').toString('base64url'), 'json'],
    ['JSON array root', encodeRaw([]), 'json'],
    ['JSON null root', encodeRaw(null), 'json'],
    ['JSON string root', encodeRaw('state'), 'json'],
    ['JSON number root', encodeRaw(42), 'json'],
  ])('rejects %s as %s', (_label, encoded, category) => {
    const message = failureOf(encoded);
    expect(message).toBe(`${ERROR_PREFIX}${category}`);
  });
});

/** One field-rule negative: break `field` with `value`, expect `category`. */
interface IFieldCase {
  readonly label: string;
  readonly field: string;
  readonly value: unknown;
  readonly category: string;
}

describe('PersistentAuthStateCodec — field rule failures', () => {
  const instanceIdUpper = INSTANCE_ID.toUpperCase();
  const tokenWithoutSignature = ACCESS_TOKEN.slice(0, ACCESS_TOKEN.lastIndexOf('.') + 1);

  it.each<IFieldCase>([
    { label: 'an extra key', field: 'extra', value: 'x', category: 'shape' },
    { label: 'version 2', field: 'version', value: 2, category: 'version' },
    { label: 'version as a string', field: 'version', value: '1', category: 'version' },
    { label: 'another provider', field: 'provider', value: 'other-provider', category: 'provider' },
    { label: 'another account', field: 'account', value: '0507654321', category: 'account' },
    {
      label: 'an uppercase instance ID',
      field: 'clientInstanceId',
      value: instanceIdUpper,
      category: 'clientInstanceId',
    },
    {
      label: 'a UUID v1 instance ID',
      field: 'clientInstanceId',
      value: 'c232ab00-9414-11ec-b3c8-9f6bdeced846',
      category: 'clientInstanceId',
    },
    {
      label: 'a numeric instance ID',
      field: 'clientInstanceId',
      value: 42,
      category: 'clientInstanceId',
    },
    { label: 'an empty device ID', field: 'deviceId', value: '', category: 'deviceId' },
    {
      label: 'a 257-char device ID',
      field: 'deviceId',
      value: 'd'.repeat(257),
      category: 'deviceId',
    },
    { label: 'a null device ID', field: 'deviceId', value: null, category: 'deviceId' },
    { label: 'a non-JWT token', field: 'accessToken', value: 'not-a-jwt', category: 'accessToken' },
    {
      label: 'a JWT without exp',
      field: 'accessToken',
      value: makeJwtWithClaims({ sub: 'fixture' }),
      category: 'accessToken',
    },
    {
      label: 'a JWT with a string exp',
      field: 'accessToken',
      value: makeJwtWithClaims({ exp: '4102444800' }),
      category: 'accessToken',
    },
    {
      label: 'a JWT with an empty segment',
      field: 'accessToken',
      value: tokenWithoutSignature,
      category: 'accessToken',
    },
    {
      label: 'a four-segment token',
      field: 'accessToken',
      value: `${ACCESS_TOKEN}.extra`,
      category: 'accessToken',
    },
    {
      label: 'a 16385-char JWT',
      field: 'accessToken',
      value: makeJwtOfLength(16_385),
      category: 'accessToken',
    },
    {
      label: 'an empty key',
      field: 'ecPrivateKeyPkcs8Base64',
      value: '',
      category: 'ecPrivateKey',
    },
    {
      label: 'a 2049-char key',
      field: 'ecPrivateKeyPkcs8Base64',
      value: 'A'.repeat(2049),
      category: 'ecPrivateKey',
    },
    {
      label: 'a garbage key',
      field: 'ecPrivateKeyPkcs8Base64',
      value: 'Z2FyYmFnZQ==',
      category: 'ecPrivateKey',
    },
    {
      label: 'an RSA key',
      field: 'ecPrivateKeyPkcs8Base64',
      value: foreignPkcs8('rsa'),
      category: 'ecPrivateKey',
    },
    {
      label: 'a P-384 key',
      field: 'ecPrivateKeyPkcs8Base64',
      value: foreignPkcs8('p384'),
      category: 'ecPrivateKey',
    },
  ])('rejects $label', ({ field, value, category }) => {
    const raw = withField(field, value);
    const encoded = encodeRaw(raw);
    const message = failureOf(encoded);
    expect(message).toBe(`${ERROR_PREFIX}${category}`);
  });

  it('rejects a missing key as shape', () => {
    const entries = Object.entries(VALID_STATE);
    const kept = entries.filter(([key]): boolean => key !== 'deviceId');
    const raw = Object.fromEntries(kept);
    const encoded = encodeRaw(raw);
    const message = failureOf(encoded);
    expect(message).toBe(`${ERROR_PREFIX}shape`);
  });

  it('rejects an own __proto__ key as shape', () => {
    const json = JSON.stringify(VALID_STATE).replace(/^\{/, '{"__proto__":{"x":1},');
    const encoded = Buffer.from(json, 'utf8').toString('base64url');
    const message = failureOf(encoded);
    expect(message).toBe(`${ERROR_PREFIX}shape`);
  });

  it('rejects a 33-char account even when it matches the expectation', () => {
    const longAccount = '1'.repeat(33);
    const raw = withField('account', longAccount);
    const encoded = encodeRaw(raw);
    const message = failureOf(encoded, { provider: PROVIDER, account: longAccount });
    expect(message).toBe(`${ERROR_PREFIX}account`);
  });

  it('never echoes a state value in the failure text', () => {
    const raw = withField('provider', 'other-provider');
    const encoded = encodeRaw(raw);
    const message = failureOf(encoded);
    const secrets = [ACCESS_TOKEN, VALID_STATE.ecPrivateKeyPkcs8Base64, INSTANCE_ID];
    const leaked = secrets.filter((secret): boolean => message.includes(secret));
    expect(leaked).toEqual([]);
    expect(message).not.toContain(VALID_STATE.deviceId);
    expect(message).not.toContain(ACCOUNT);
  });
});

describe('PersistentAuthStateCodec — encode refuses state the next run would reject', () => {
  it.each([
    ['another account', { ...VALID_STATE, account: '0507654321' }, 'account'],
    ['an invalid key', { ...VALID_STATE, ecPrivateKeyPkcs8Base64: 'Z2FyYmFnZQ==' }, 'ecPrivateKey'],
    ['a token without exp', { ...VALID_STATE, accessToken: 'a.b.c' }, 'accessToken'],
  ])('refuses %s', (_label, state, category) => {
    const result = encodePersistentAuthState(state, EXPECTED);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe(`${ERROR_PREFIX}${category}`);
  });
});
