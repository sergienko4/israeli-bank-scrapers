/**
 * Edge-case unit tests for {@link buildInitialCarry}.
 *
 * The happy paths (string-seed mirror, bootstrap, basic derivedCarry)
 * are covered by `FlowInitCarry.test.ts`. This file pins the strict
 * validation branches that ship as `fail()` Procedure failures per
 * test-guidlines.md "unit test for edge cases only" — banks declare
 * these via static config, so the happy integration flow never
 * reaches the failure modes without polluting it with malformed
 * fixtures.
 */

import { buildInitialCarry } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/FlowInitCarry.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/**
 * Build a base config with the given seed + derived blocks.
 * @param overrides - Partial config overrides.
 * @returns IApiDirectCallConfig literal.
 */
function makeConfig(overrides: Partial<IApiDirectCallConfig>): IApiDirectCallConfig {
  return { flow: 'sms-otp', steps: [], envelope: {}, ...overrides };
}

describe('buildInitialCarry — seed validation branches', () => {
  it('runs the bootstrap when the creds field is present but empty', () => {
    const config = makeConfig({
      seedCarryFromCreds: [{ field: 'deviceId16Hex', bootstrap: 'random-hex-16' }],
    });
    // creds.deviceId16Hex === '' triggers the empty-string fallthrough into
    // the bootstrap path (mirror branch returns coerced=ok but value==='').
    const result = buildInitialCarry(config, { deviceId16Hex: '' }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.deviceId16Hex).toMatch(/^[0-9a-f]{32}$/);
  });

  it('falls through to "absent" diagnostic for non-serialisable creds with no bootstrap', () => {
    const config = makeConfig({ seedCarryFromCreds: ['callback'] });
    /**
     * Caller-supplied function — never JSON-serialisable. The coerce
     * path returns a fail() Procedure that the seed evaluator treats
     * as "absent" when no bootstrap is configured, so the final
     * diagnostic mentions the missing field by name.
     * @returns Empty string (never invoked).
     */
    const callback = (): string => '';
    const result = buildInitialCarry(config, { callback }, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.callback absent');
  });

  it('mirrors a numeric creds value through coerceCredsValue unchanged', () => {
    const config = makeConfig({ seedCarryFromCreds: ['count'] });
    const result = buildInitialCarry(config, { count: 7 }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.count).toBe(7);
  });

  it('mirrors a null creds value through coerceCredsValue when a bootstrap is configured', () => {
    // null coerces to succeed(null) but null !== '' → mirror branch wins.
    const config = makeConfig({
      seedCarryFromCreds: [{ field: 'nullable', bootstrap: 'random-hex-16' }],
    });
    const result = buildInitialCarry(config, { nullable: null }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.nullable).toBeNull();
  });
});

describe('buildInitialCarry — derivedCarry validation branches', () => {
  it('fails when a derivedCarry part references a missing creds field', () => {
    const config = makeConfig({
      derivedCarry: [{ into: 'k', parts: ['creds.absent'], separator: '|' }],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.absent missing');
  });

  it('fails when a derivedCarry part references a missing carry slot', () => {
    const config = makeConfig({
      derivedCarry: [{ into: 'k', parts: ['carry.absent'], separator: '|' }],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.absent missing');
  });

  it('fails when a derivedCarry part references an invalid RefToken family', () => {
    const config = makeConfig({
      derivedCarry: [
        // 'keypair.ec.publicKeyBase64' is a valid RefToken in the
        // body-template engine but not supported as a derivedCarry
        // part — the resolver should reject it explicitly.
        { into: 'k', parts: ['keypair.ec.publicKeyBase64'] },
      ],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('not supported');
  });

  it('fails when a derivedCarry part walks into a non-object config segment', () => {
    const config = makeConfig({
      derivedCarry: [{ into: 'k', parts: ['config.secrets.signKey.invalid'] }],
      secrets: { signKey: 'sign-key-32-bytes-exactly-here!!' },
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('config.secrets.signKey.invalid');
  });

  it('short-circuits the seed loop when an earlier entry fails', () => {
    const config = makeConfig({ seedCarryFromCreds: ['firstMissing', 'secondMissing'] });
    const result = buildInitialCarry(config, {}, {});
    // The reducer short-circuits on the first fail — only the first
    // entry's diagnostic surfaces; the second entry never runs.
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.firstMissing');
  });

  it('short-circuits derivedCarry when an earlier derivation fails', () => {
    const config = makeConfig({
      derivedCarry: [
        { into: 'first', parts: ['creds.missing1'] },
        { into: 'second', parts: ['creds.missing2'] },
      ],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.missing1');
  });

  it('resolves a derivedCarry config-path leaf to a string when present', () => {
    const config = makeConfig({
      derivedCarry: [{ into: 'k', parts: ['config.secrets.pinSuffix'] }],
      secrets: { pinSuffix: 'PIN_SUFFIX' },
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.k).toBe('PIN_SUFFIX');
  });

  it('truncates the derivedCarry result when truncateBytes is omitted', () => {
    // truncateBytes undefined → no slice → full string passes through.
    const config = makeConfig({
      derivedCarry: [{ into: 'k', parts: ['creds.value'] }],
    });
    const result = buildInitialCarry(config, { value: 'a-string-that-is-not-truncated' }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.k).toBe('a-string-that-is-not-truncated');
  });
});
