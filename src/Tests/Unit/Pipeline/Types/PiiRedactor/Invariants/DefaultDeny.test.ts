/**
 * Phase 6 invariant — default-deny.
 *
 * Documents the EXISTING invariant of the unified {@link redact} entry
 * point: any value that does not classify into a known PiiCategory
 * must yield the `[REDACTED]` hint, never the raw input. The test is
 * GREEN at commit 1 against the current `PiiRedactor.ts` and stays
 * GREEN through the strategy-registry refactor (commits 2-6).
 *
 * Permanent canary — Phase 7 / Phase 9 allowlists exempt this file
 * from the body-freeze rule because it documents an architectural
 * invariant, not a one-off bug fix.
 */

import { redact, REDACTED_HINT } from '../../../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

describe('PiiRedactor default-deny invariant', () => {
  it('returns the REDACTED hint for symbol values', () => {
    const exotic = Symbol('exotic') as unknown;
    const result = redact(exotic);
    expect(result).toBe(REDACTED_HINT);
  });

  it('returns the REDACTED hint for empty objects', () => {
    const empty = {};
    const result = redact(empty);
    expect(result).toBe(REDACTED_HINT);
  });

  it('returns the REDACTED hint for unclassified plain strings', () => {
    const debugString = 'some-arbitrary-debug-string';
    const result = redact(debugString);
    expect(result).toBe(REDACTED_HINT);
  });
});
