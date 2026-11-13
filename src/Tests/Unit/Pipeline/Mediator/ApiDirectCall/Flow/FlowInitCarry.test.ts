/**
 * Unit tests for FlowInitCarry — `seedCarryFromCreds` (string + bootstrap
 * variants, `random-hex` included) and `derivedCarry` (parts + separator
 * + truncation, the `format` and `md5-hex` ops).
 */

import type {
  DerivedOp,
  IApiDirectCallConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildInitialCarry } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/FlowInitCarry.js';

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

  it('always bootstraps a fresh ID despite supplied credentials and initial carry', () => {
    const bootstrap = { kind: 'random-hex', bytes: 32, isUpperCase: true } as const;
    const seed = { field: 'flowId', bootstrap, alwaysBootstrap: true } as const;
    const config = makeConfig({ seedCarryFromCreds: [seed] });
    const first = buildInitialCarry(config, { flowId: 'credential-value' }, { flowId: 'old' });
    const second = buildInitialCarry(config, { flowId: 'credential-value' }, { flowId: 'old' });
    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.value.flowId).toMatch(/^[A-F0-9]{64}$/);
      expect(first.value.flowId).not.toBe(second.value.flowId);
    }
  });

  it('refuses an unconditional deterministic seed even without builder validation', () => {
    const bootstrap = { kind: 'sha256-prefix-16', from: 'phone' } as const;
    const seed = { field: 'flowId', bootstrap, alwaysBootstrap: true } as const;
    const config = makeConfig({ seedCarryFromCreds: [seed] });
    const result = buildInitialCarry(config, { phone: 'synthetic' }, {});
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'seedCarryFromCreds: alwaysBootstrap needs a random bootstrap',
    });
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

  it('seeds from config.secrets when the creds field is absent', () => {
    const config = makeConfig({
      secrets: { deviceSignature: 'captured-default' },
      seedCarryFromCreds: [{ field: 'deviceSignature', fallbackSecret: 'deviceSignature' }],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.deviceSignature).toBe('captured-default');
  });

  it('lets credentials override the fallback secret', () => {
    const config = makeConfig({
      secrets: { deviceSignature: 'captured-default' },
      seedCarryFromCreds: [{ field: 'deviceSignature', fallbackSecret: 'deviceSignature' }],
    });
    const result = buildInitialCarry(config, { deviceSignature: 'caller-value' }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.deviceSignature).toBe('caller-value');
  });

  it('fails when the fallback secret is absent or empty', () => {
    const missing = makeConfig({
      seedCarryFromCreds: [{ field: 'deviceSignature', fallbackSecret: 'missing' }],
    });
    const result = buildInitialCarry(missing, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('config.secrets.missing absent');
  });

  it('rejects an inherited object property as a fallback secret', () => {
    const inherited = makeConfig({
      seedCarryFromCreds: [{ field: 'deviceSignature', fallbackSecret: 'constructor' }],
    });
    const result = buildInitialCarry(inherited, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('config.secrets.constructor absent');
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
 * Derive `uid` from `creds.user`, lower-cased, and run flow init once.
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

describe('FlowInitCarry — derivedCarry lower transform', () => {
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

/** The two id rules of the `format` op, first match wins. */
const ID_FORMAT: DerivedOp = {
  kind: 'format',
  rules: [
    { pattern: String.raw`^\d{1,9}$`, prefix: '00001', padStart: 9 },
    { pattern: String.raw`^9\d{9}$`, prefix: '0000' },
  ],
};

/**
 * Derive `uid` from `creds.num` through an op, then `uidMd5` from it, and
 * run flow init once.
 * @param num - The typed number.
 * @param op - The op that shapes `uid`.
 * @returns Both slots, or the failure text.
 */
function deriveOp(num: string, op: DerivedOp): unknown {
  const config = makeConfig({
    derivedCarry: [
      { into: 'uid', parts: ['creds.num'], op },
      { into: 'uidMd5', parts: ['carry.uid'], op: { kind: 'md5-hex' } },
    ],
  });
  const result = buildInitialCarry(config, { num }, {});
  return result.success ? [result.value.uid, result.value.uidMd5] : result.errorMessage;
}

describe('FlowInitCarry — derivedCarry ops', () => {
  it.each<[string, string]>([
    ['12345', '00001000012345'],
    ['9', '00001000000009'],
    ['987654321', '00001987654321'],
    ['9123456789', '00009123456789'],
  ])('format shapes %s by the first matching rule', (num, uid) => {
    const [formatted] = deriveOp(num, ID_FORMAT) as readonly string[];
    expect(formatted).toBe(uid);
  });

  it('md5-hex digests the formatted slot as lower-case hex', () => {
    const [, uidMd5] = deriveOp('12345', ID_FORMAT) as readonly string[];
    expect(uidMd5).toBe('857bd120487a9d42df57c302799bf203');
  });

  it('uses the first format rule when more than one matches the input', () => {
    const overlapping: DerivedOp = {
      kind: 'format',
      rules: [
        { pattern: String.raw`^\d+$`, prefix: 'first' },
        { pattern: String.raw`^\d+$`, prefix: 'second' },
      ],
    };
    const [formatted] = deriveOp('123', overlapping) as readonly string[];
    expect(formatted).toBe('first123');
  });

  it.each<[string, string]>([
    ['abc', 'letters'],
    ['1234567890', 'ten digits not led by 9'],
    ['', 'an empty value'],
  ])('format fails on %j (%s), naming the slot only', num => {
    const failure = deriveOp(num, ID_FORMAT);
    expect(failure).toBe('derivedCarry: uid unformattable');
  });

  it('anchors a pattern that the config left open', () => {
    const open: DerivedOp = { kind: 'format', rules: [{ pattern: String.raw`\d{3}`, prefix: '' }] };
    const failure = deriveOp('12345', open);
    expect(failure).toBe('derivedCarry: uid unformattable');
  });

  it('runs the op last, over the lower-cased text', () => {
    const op = { kind: 'md5-hex' } as const;
    const config = makeConfig({
      derivedCarry: [{ into: 'digest', parts: ['creds.user'], transform: 'lower', op }],
    });
    const result = buildInitialCarry(config, { user: 'ABC' }, {});
    expect(result).toMatchObject({ value: { digest: '900150983cd24fb0d6963f7d28e17f72' } });
  });

  it('truncates before the op digests the text', () => {
    const config = makeConfig({
      derivedCarry: [
        { into: 'digest', parts: ['creds.user'], truncateBytes: 3, op: { kind: 'md5-hex' } },
      ],
    });
    const result = buildInitialCarry(config, { user: 'abcdef' }, {});
    expect(result).toMatchObject({ value: { digest: '900150983cd24fb0d6963f7d28e17f72' } });
  });

  it('digests UTF-8 bytes', () => {
    const config = makeConfig({
      derivedCarry: [{ into: 'digest', parts: ['creds.user'], op: { kind: 'md5-hex' } }],
    });
    const result = buildInitialCarry(config, { user: 'é' }, {});
    expect(result).toMatchObject({ value: { digest: '66ddcd97cfdeabb2f6fb8a999b4bc76f' } });
  });
});
