/**
 * Device-memory state codec: the opaque state holds only the server-issued
 * device id, bound to one provider and one lower-cased account. Every
 * refusal names a category and never echoes a stored value.
 */

import {
  decodeDeviceMemoryState,
  encodeDeviceMemoryState,
  type IDeviceMemoryStateV1,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceMemoryStateCodec.js';

const EXPECTED = { provider: 'syn-web', account: 'syn-user' };

const VALID_STATE: IDeviceMemoryStateV1 = {
  version: 1,
  kind: 'device-memory',
  provider: 'syn-web',
  account: 'syn-user',
  deviceId: 'syn-device.01:a_b',
};

const SECRET_DEVICE_ID = 'syn-secret-device';

/**
 * Encode any object the way the codec does, bypassing its validation.
 * @param raw - Object to encode.
 * @returns Base64url JSON.
 */
function encodeRaw(raw: object): string {
  const json = JSON.stringify(raw);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a raw object against the default expectation.
 * @param raw - Object to encode then decode.
 * @returns Decode result.
 */
function decodeRaw(raw: object): ReturnType<typeof decodeDeviceMemoryState> {
  const encoded = encodeRaw(raw);
  return decodeDeviceMemoryState(encoded, EXPECTED);
}

/**
 * The failure a category-only refusal carries.
 * @param category - Expected category.
 * @returns Partial failure matcher.
 */
function refusal(category: string): object {
  return { success: false, errorMessage: `persistent auth state invalid: ${category}` };
}

describe('device-memory state round trip', () => {
  it('decodes what it encodes', () => {
    const encoded = encodeDeviceMemoryState(VALID_STATE, EXPECTED);
    expect(encoded.success).toBe(true);
    const encodedText = encoded.success ? encoded.value : '';
    const decoded = decodeDeviceMemoryState(encodedText, EXPECTED);
    expect(decoded).toEqual({ success: true, value: VALID_STATE });
  });

  it('accepts a 256-character device id made of word, dot, colon and dash', () => {
    const deviceId = `${'a'.repeat(252)}._:-`;
    const decoded = decodeRaw({ ...VALID_STATE, deviceId });
    expect(decoded).toMatchObject({ success: true, value: { deviceId } });
  });
});

describe('device-memory state refusals', () => {
  const withoutDeviceId = {
    version: 1,
    kind: 'device-memory',
    provider: VALID_STATE.provider,
    account: VALID_STATE.account,
  };

  it.each([
    ['a missing key', withoutDeviceId, 'shape'],
    ['an extra key', { ...VALID_STATE, token: 'x' }, 'shape'],
    ['an unknown version', { ...VALID_STATE, version: 2 }, 'version'],
    ['the bound-device kind', { ...VALID_STATE, kind: 'bound-device' }, 'kind'],
    ['another provider', { ...VALID_STATE, provider: 'other-web' }, 'provider'],
    ['another account', { ...VALID_STATE, account: 'other-user' }, 'account'],
    ['an upper-case account', { ...VALID_STATE, account: 'SYN-USER' }, 'account'],
    ['an empty device id', { ...VALID_STATE, deviceId: '' }, 'deviceId'],
    ['a device id with a space', { ...VALID_STATE, deviceId: 'syn device' }, 'deviceId'],
    ['a device id with a slash', { ...VALID_STATE, deviceId: 'syn/device' }, 'deviceId'],
    ['a 257-character device id', { ...VALID_STATE, deviceId: 'a'.repeat(257) }, 'deviceId'],
    ['a numeric device id', { ...VALID_STATE, deviceId: 42 }, 'deviceId'],
  ])('refuses %s', (_label, raw: object, category: string) => {
    const decoded = decodeRaw(raw);
    const expected = refusal(category);
    expect(decoded).toMatchObject(expected);
  });

  it('refuses an account longer than 64 characters even when expected', () => {
    const account = 'a'.repeat(65);
    const encoded = encodeRaw({ ...VALID_STATE, account });
    const decoded = decodeDeviceMemoryState(encoded, { ...EXPECTED, account });
    const expected = refusal('account');
    expect(decoded).toMatchObject(expected);
  });

  it('refuses a bound-device state as a foreign shape', () => {
    const bound = { version: 1, provider: 'syn-web', account: 'syn-user', deviceId: 'd' };
    const decoded = decodeRaw({ ...bound, accessToken: 't', clientInstanceId: 'c' });
    const expected = refusal('shape');
    expect(decoded).toMatchObject(expected);
  });

  it('refuses to encode a state it could not decode back', () => {
    const encoded = encodeDeviceMemoryState({ ...VALID_STATE, deviceId: 'a/b' }, EXPECTED);
    const expected = refusal('deviceId');
    expect(encoded).toMatchObject(expected);
  });

  it('never echoes a stored value in a refusal', () => {
    const decoded = decodeRaw({ ...VALID_STATE, deviceId: SECRET_DEVICE_ID, provider: 'x' });
    const text = JSON.stringify(decoded);
    expect(text).not.toContain(SECRET_DEVICE_ID);
    expect(text).not.toContain('syn-user');
  });
});
