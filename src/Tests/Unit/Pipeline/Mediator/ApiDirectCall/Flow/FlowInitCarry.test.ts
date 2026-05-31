/**
 * Unit tests for FlowInitCarry — `seedCarryFromCreds` (string + bootstrap
 * variants) and `derivedCarry` (parts + separator + truncation).
 */

import { buildInitialCarry } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/FlowInitCarry.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

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

describe('FlowInitCarry.buildInitialCarry', () => {
  it('mirrors a creds field into carry under the same name', () => {
    const config = makeConfig({ seedCarryFromCreds: ['phoneNumber'] });
    const result = buildInitialCarry(config, { phoneNumber: '972-000000000' }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.phoneNumber).toBe('972-000000000');
  });

  it('runs the random-hex-16 bootstrap when creds value is absent', () => {
    const config = makeConfig({
      seedCarryFromCreds: [{ field: 'deviceId16Hex', bootstrap: 'random-hex-16' }],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(true);
    if (result.success) {
      const value = result.value.deviceId16Hex;
      expect(typeof value).toBe('string');
      expect(value).toMatch(/^[0-9a-f]{32}$/);
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
