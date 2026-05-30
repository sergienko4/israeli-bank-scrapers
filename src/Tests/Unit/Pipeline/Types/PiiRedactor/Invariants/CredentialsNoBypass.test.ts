/**
 * Phase 6 invariant — credentials no-bypass.
 *
 * Documents the EXISTING invariant of the unified {@link redact} entry
 * point: token / OTP / cookie shaped values must be redacted EVEN when
 * `PII_REDACTION=off`. Auth credentials are live security material and
 * MUST NOT leak through the dev-mode bypass other categories enjoy.
 *
 * GREEN at commit 1 (the entry point classifies credentials before
 * the bypass check) and GREEN through the Facade composition that
 * lands in commit 5 (the AuthCredentials strategy carries the
 * `alwaysRedact: true` flag).
 *
 * Permanent canary — Phase 7 / Phase 9 allowlists exempt this file
 * from the body-freeze rule.
 */

import { redact } from '../../../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

describe('PiiRedactor credentials no-bypass invariant', () => {
  beforeAll(() => {
    process.env.PII_REDACTION = 'off';
  });

  afterAll(() => {
    delete process.env.PII_REDACTION;
  });

  it.each([
    ['token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload'],
    ['otp', '123456'],
    ['cookie', 'session=abc123def456'],
  ])('redacts %s shaped value even with PII_REDACTION=off', (_label, value) => {
    const result = redact(value);
    expect(result).not.toBe(value);
  });
});
