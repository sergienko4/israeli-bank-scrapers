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

/**
 * Build a JWT-shaped string (3 base64url segments) carrying the
 * supplied payload object. The header + signature segments are
 * deliberately opaque — server-side verification is out of scope here
 * and the decoder only reads the middle segment.
 * @param payload - JWT payload object to encode.
 * @returns Three-segment JWT string.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}', 'utf8').toString('base64url');
  const payloadJson = JSON.stringify(payload);
  const body = Buffer.from(payloadJson, 'utf8').toString('base64url');
  return `${header}.${body}.opaque-signature`;
}

describe('buildInitialCarry — jwt-claim bootstrap branches', () => {
  it('extracts a nested string claim via dotted path', () => {
    const jwt = makeJwt({ pl: { uId: 'fixt-uid-12345' } });
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'uId', bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.uId' } },
      ],
    });
    const result = buildInitialCarry(config, { tokenField: jwt }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.uId).toBe('fixt-uid-12345');
  });

  it('fails when the source creds field is absent', () => {
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'uId', bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.uId' } },
      ],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.tokenField missing or empty');
  });

  it('returns empty string when source is absent AND optional flag is set', () => {
    // Optional jwt-claim is for warm/cold-aware seeds: when the
    // creds field carrying the JWT is absent the bootstrap stays
    // silent and the carry slot is left empty for a later login
    // step's extractsToCarry to fill (cold path).
    const config = makeConfig({
      seedCarryFromCreds: [
        {
          field: 'uId',
          bootstrap: {
            kind: 'jwt-claim',
            from: 'tokenField',
            claim: 'pl.uId',
            optional: true,
          },
        },
      ],
    });
    const result = buildInitialCarry(config, {}, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.uId).toBe('');
  });

  it('still extracts the claim when optional is set AND source is present', () => {
    // Optional should NOT change the warm-path behaviour — when the
    // JWT is present the claim is extracted exactly as the strict
    // branch would.
    const jwt = makeJwt({ pl: { uId: 'fixt-uid-warm' } });
    const config = makeConfig({
      seedCarryFromCreds: [
        {
          field: 'uId',
          bootstrap: {
            kind: 'jwt-claim',
            from: 'tokenField',
            claim: 'pl.uId',
            optional: true,
          },
        },
      ],
    });
    const result = buildInitialCarry(config, { tokenField: jwt }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.uId).toBe('fixt-uid-warm');
  });

  it('fails when the source creds value is not a 3-segment JWT', () => {
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'uId', bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.uId' } },
      ],
    });
    const result = buildInitialCarry(config, { tokenField: 'not.a.valid.jwt' }, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('JWT must have 3 segments');
  });

  it('fails when the JWT payload is not valid JSON', () => {
    const malformed = `${Buffer.from('hdr', 'utf8').toString('base64url')}.${Buffer.from('not-json', 'utf8').toString('base64url')}.sig`;
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'uId', bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.uId' } },
      ],
    });
    const result = buildInitialCarry(config, { tokenField: malformed }, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('payload decode failed');
  });

  it('fails when the claim path misses (intermediate segment absent)', () => {
    const jwt = makeJwt({ pl: { other: 'value' } });
    const config = makeConfig({
      seedCarryFromCreds: [
        {
          field: 'uId',
          bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.absent.deep' },
        },
      ],
    });
    const result = buildInitialCarry(config, { tokenField: jwt }, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain("path 'pl.absent.deep' miss");
  });

  it('fails on deep claim paths where the failure short-circuits the reducer', () => {
    // Four-segment path where pl.a is undefined; the reducer hits its
    // own `if (!isOk(acc)) return acc` short-circuit on segment c.
    const jwt = makeJwt({ pl: { x: 'val' } });
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'k', bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.a.b.c' } },
      ],
    });
    const result = buildInitialCarry(config, { tokenField: jwt }, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('miss at');
  });

  it('fails when the claim leaf is non-string', () => {
    const jwt = makeJwt({ pl: { count: 42 } });
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'count', bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.count' } },
      ],
    });
    const result = buildInitialCarry(config, { tokenField: jwt }, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain("path 'pl.count' non-string");
  });

  it('mirrors the creds field directly when present (skips the bootstrap)', () => {
    // Mirror branch beats the bootstrap when creds.uId is already a non-empty string.
    const config = makeConfig({
      seedCarryFromCreds: [
        { field: 'uId', bootstrap: { kind: 'jwt-claim', from: 'tokenField', claim: 'pl.uId' } },
      ],
    });
    const result = buildInitialCarry(config, { uId: 'already-set', tokenField: 'unused' }, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.uId).toBe('already-set');
  });
});
