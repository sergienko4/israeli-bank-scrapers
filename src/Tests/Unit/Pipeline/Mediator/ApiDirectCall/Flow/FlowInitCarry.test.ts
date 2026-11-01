/**
 * Unit tests for FlowInitCarry — `seedCarryFromCreds` (string + bootstrap
 * variants, N42 `random-hex` included) and `derivedCarry` (parts + separator
 * + truncation).
 */

import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildInitialCarry } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/FlowInitCarry.js';

/**
 * Build a base config with the given seed + derived blocks.
 * @param overrides - Partial config overrides.
 * @returns IApiDirectCallConfig literal.
 */
function makeConfig(overrides: Partial<IApiDirectCallConfig>): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    steps: [],
    envelope: {},
    ...overrides,
  };
}

/** Canonical lowercase RFC 9562 UUID version 4 (variant 10xx). */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Seed block that bootstraps `clientInstanceId` with a random UUID. */
const UUID_SEED: Partial<IApiDirectCallConfig> = {
  seedCarryFromCreds: [{ field: 'clientInstanceId', bootstrap: { kind: 'random-uuid' } }],
};

/**
 * Seed `flowId` from a `random-hex` bootstrap and run flow init once.
 * @param bytes - Random bytes to draw.
 * @param isUpperCase - Upper-case hex when true.
 * @returns The seeded slot, or the failure text.
 */
function seedRandomHex(bytes: number, isUpperCase: boolean): unknown {
  const bootstrap = { kind: 'random-hex', bytes, isUpperCase } as const;
  const config = makeConfig({ seedCarryFromCreds: [{ field: 'flowId', bootstrap }] });
  const result = buildInitialCarry(config, {}, {});
  return result.success ? result.value.flowId : result.errorMessage;
}

describe('FlowInitCarry.buildInitialCarry', () => {
  it.each<[number, boolean, RegExp]>([
    [32, true, /^[\dA-F]{64}$/],
    [1, false, /^[\da-f]{2}$/],
    [64, false, /^[\da-f]{128}$/],
  ])('random-hex of %i bytes (upper %s) seeds its hex', (bytes, isUpperCase, pattern) => {
    const value = seedRandomHex(bytes, isUpperCase);
    expect(value).toMatch(pattern);
  });

  it('draws a fresh random-hex value for each flow init', () => {
    const first = seedRandomHex(32, true);
    const second = seedRandomHex(32, true);
    expect(first).not.toBe(second);
  });

  it('mirrors a creds value instead of drawing random-hex', () => {
    const bootstrap = { kind: 'random-hex', bytes: 32, isUpperCase: true } as const;
    const config = makeConfig({ seedCarryFromCreds: [{ field: 'flowId', bootstrap }] });
    const result = buildInitialCarry(config, { flowId: 'kept' }, {});
    expect(result).toEqual({ success: true, value: { flowId: 'kept' } });
  });

  it('mirrors a creds field into carry under the same name', () => {
    const config = makeConfig({ seedCarryFromCreds: ['phoneNumber'] });
    const result = buildInitialCarry(config, { phoneNumber: '972-000000000' }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.phoneNumber).toBe('972-000000000');
  });

  it('runs the random-hex-16 bootstrap when creds value is absent', () => {
    const config = makeConfig({
      seedCarryFromCreds: [{ field: 'deviceId16Hex', bootstrap: { kind: 'random-hex-16' } }],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(true);
    if (result.success) {
      const value = result.value.deviceId16Hex;
      expect(typeof value).toBe('string');
      expect(value).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('runs the random-uuid bootstrap when creds value is absent', () => {
    const config = makeConfig(UUID_SEED);
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.clientInstanceId).toMatch(UUID_V4);
  });

  it('generates a distinct random-uuid value for each separate cold flow', () => {
    const config = makeConfig(UUID_SEED);
    const first = buildInitialCarry(config, {}, {});
    const second = buildInitialCarry(config, {}, {});
    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.value.clientInstanceId).not.toBe(second.value.clientInstanceId);
    }
  });

  it('shares one random-uuid value with every derivation in the same flow', () => {
    const config = makeConfig({
      ...UUID_SEED,
      derivedCarry: [
        { into: 'loginId', parts: ['carry.clientInstanceId'] },
        { into: 'assertId', parts: ['carry.clientInstanceId'] },
      ],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.loginId).toBe(result.value.clientInstanceId);
      expect(result.value.assertId).toBe(result.value.clientInstanceId);
    }
  });

  it('fails when a bare-string seed field is missing from creds', () => {
    const config = makeConfig({ seedCarryFromCreds: ['phoneNumber'] });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.phoneNumber absent');
  });

  it('evaluates derivedCarry parts in order with separator + truncation', () => {
    const config = makeConfig({
      seedCarryFromCreds: ['deviceId'],
      derivedCarry: [
        {
          into: 'otpKey',
          parts: ['carry.deviceId', 'config.secrets.pinSuffix'],
          separator: '|',
          truncateBytes: 16,
        },
      ],
      secrets: { pinSuffix: 'PIN_SUFFIX_VALUE_LONG_TAIL' },
    });
    const result = buildInitialCarry(config, { deviceId: 'abc123' }, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.otpKey).toBe('abc123|PIN_SUFFI');
      expect((result.value.otpKey as string).length).toBe(16);
    }
  });

  it('preserves initialCarry values supplied by the caller', () => {
    const config = makeConfig({});
    const result = buildInitialCarry(config, {}, { flowId: 'fid-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.flowId).toBe('fid-1');
  });

  it('derives deterministic 16-hex via sha256-prefix-16 bootstrap from another creds field', () => {
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'deviceId16Hex', bootstrap: { kind: 'sha256-prefix-16', from: 'phoneNumber' } },
      ],
    });
    const phone = '972-000000000';
    const first = buildInitialCarry(config, { phoneNumber: phone }, {});
    const second = buildInitialCarry(config, { phoneNumber: phone }, {});
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.value.deviceId16Hex).toMatch(/^[0-9a-f]{16}$/);
      // Determinism is the load-bearing property: same phone in → same
      // deviceId out, so a cached long-term token bound to the
      // deviceId on the server stays valid across warm-start runs.
      expect(first.value.deviceId16Hex).toBe(second.value.deviceId16Hex);
    }
  });

  it('produces a different sha256-prefix-16 value for a different source creds value', () => {
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'deviceId16Hex', bootstrap: { kind: 'sha256-prefix-16', from: 'phoneNumber' } },
      ],
    });
    const left = buildInitialCarry(config, { phoneNumber: '972-000000000' }, {});
    const right = buildInitialCarry(config, { phoneNumber: '972-000000001' }, {});
    expect(left.success).toBe(true);
    expect(right.success).toBe(true);
    if (left.success && right.success) {
      expect(left.value.deviceId16Hex).not.toBe(right.value.deviceId16Hex);
    }
  });

  it('fails when sha256-prefix-16 source creds field is absent', () => {
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'deviceId16Hex', bootstrap: { kind: 'sha256-prefix-16', from: 'phoneNumber' } },
      ],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errorMessage).toContain('creds.phoneNumber missing or empty');
  });
});

/**
 * Derive `uid` from `creds.user`, lower-cased (N60), and run flow init once.
 * @param user - The typed username.
 * @param truncateBytes - Optional byte cap.
 * @returns The derived slot and the creds as left after the run.
 */
function deriveLower(user: string, truncateBytes?: number): readonly [unknown, unknown] {
  const derived = {
    into: 'uid',
    parts: ['creds.user'],
    transform: 'lower',
    truncateBytes,
  } as const;
  const config = makeConfig({ derivedCarry: [derived] });
  const creds = { user };
  const result = buildInitialCarry(config, creds, {});
  return [result.success ? result.value.uid : result.errorMessage, creds.user];
}

describe('FlowInitCarry — derivedCarry lower transform (N60)', () => {
  it('lower-cases the joined text, leaving the creds value as typed', () => {
    const [uid, user] = deriveLower('AbC.Dé9');
    expect(uid).toBe('abc.dé9');
    expect(user).toBe('AbC.Dé9');
  });

  it('lower-cases before truncating, so the byte cap holds when a char grows', () => {
    // 'İ' (2 bytes) lower-cases to 'i' + U+0307 (3 bytes): 'İA' is 3 bytes, 'i̇a' is 4.
    const [uid] = deriveLower('\u0130A', 3);
    expect(uid).toBe('i\u0307');
  });
});
