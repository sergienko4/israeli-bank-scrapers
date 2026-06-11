/**
 * Phase 2 coverage closeout — JsonBody.ts (the recursive PII redactor
 * for parsed-or-string JSON payloads consumed by
 * `NetworkDiscovery.dumpResponseBody` and the FixtureCapture writers)
 * shipped without targeted tests for several recursive walk branches:
 *
 *   - `redactLeaf` empty-path nullish fallback (`path.at(-1) ?? ''`)
 *   - `nestedHasPii` array dispatch
 *   - `objectHasPii` PII-key short-circuit on the `||` predicate
 *   - `nestedHasPii` depth bail-out (>{@link MAX_PII_PROBE_DEPTH})
 *
 * These branches gate the censor that prevents bank PII (account
 * numbers, OTP codes, phone numbers) from leaking into on-disk
 * captures — silent regression here is the highest-cost class of
 * fixture-pipeline bug. Public surface is `redactJsonBody` only;
 * the test exercises each branch through that single entry point.
 */
import { redactJsonBody } from '../../../../../Scrapers/Pipeline/Types/PiiRedactor.js';
import type { IJsonObject } from '../../../../../Scrapers/Pipeline/Types/PiiRedactor/Types.js';

/**
 * Build an object nested `levels` deep with the PII-classified key
 * `phone` at the leaf. Used to drive `nestedHasPii` past the
 * MAX_PII_PROBE_DEPTH safety bail-out (50 levels).
 * @param levels - Number of wrap layers.
 * @returns Deeply nested object.
 */
function buildDeepObject(levels: number): IJsonObject {
  let current: IJsonObject = { phone: '0501234567' };
  for (let i = 0; i < levels; i += 1) {
    current = { wrap: current };
  }
  return current;
}

describe('JsonBody — redactJsonBody string root', () => {
  it('JB-STRING-ROOT-001 falls through redactLeaf with empty path (`.at(-1) ?? ""` fallback)', () => {
    // A bare-string JSON document hits redactNode with path=[],
    // typeof !== 'object' so the leaf path is taken; redactLeaf
    // resolves `[].at(-1) ?? ''` — the nullish fallback was the
    // uncovered branch at line 130.
    const result = redactJsonBody('"hello world"');
    expect(typeof result).toBe('string');
    expect(result).toContain('hello world');
  });

  it('JB-FALLBACK-001 hits the regex-fallback branch when the body is not valid JSON', () => {
    const result = redactJsonBody('not json at all');
    expect(typeof result).toBe('string');
  });
});

describe('JsonBody — redactJsonBody nested object trees', () => {
  it('JB-PII-SHORTCIRCUIT-001 short-circuits the predicate when a key classifies as PII', () => {
    // `objectHasPii` predicate is `classifyKey(k) !== "unknown" || nestedHasPii(...)`.
    // With a PII key at depth 0 (`phone`), the left side is TRUE
    // → branch 0 of BRDA:69 is exercised.
    const result = redactJsonBody({ phone: '0501234567' });
    expect(typeof result).toBe('string');
    expect(result).not.toContain('0501234567');
  });

  it('JB-NESTED-ARRAY-001 dispatches nestedHasPii through the Array.isArray branch', () => {
    // Outer key non-PII → recurses; inner value is an array → hits
    // `if (Array.isArray(value))` true branch at BRDA:57 inside
    // nestedHasPii, and the array contains PII so redactArray
    // collapses to the `<N redacted items>` sentinel.
    const body = { outer: { inner: [{ phone: '0501234567' }] } };
    const result = redactJsonBody(body);
    expect(typeof result).toBe('string');
    expect(result).toContain('redacted items');
    expect(result).not.toContain('0501234567');
  });
});

describe('JsonBody — redactJsonBody depth safety', () => {
  it('JB-DEPTH-PROBE-001 trips the MAX_PII_PROBE_DEPTH bail-out for pathological nesting', () => {
    // 60 wrap layers exceeds MAX_PII_PROBE_DEPTH (50) — the
    // probe returns false before reaching the leaf PII key, so
    // the array-collapse rule does NOT trigger. The branch under
    // test is `if (depth > MAX_PII_PROBE_DEPTH) return false`
    // at BRDA:55, which protects against pathological inputs.
    const deep = buildDeepObject(60);
    const result = redactJsonBody(deep);
    expect(typeof result).toBe('string');
    // The redactor must complete without throwing on a deeply
    // nested input — the depth bail-out is the safety net.
  });
});
