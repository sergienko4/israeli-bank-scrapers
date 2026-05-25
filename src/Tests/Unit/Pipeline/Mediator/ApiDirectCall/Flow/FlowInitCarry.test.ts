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
    const result = buildInitialCarry(config, { phoneNumber: '972-546218739' }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.phoneNumber).toBe('972-546218739');
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
});
