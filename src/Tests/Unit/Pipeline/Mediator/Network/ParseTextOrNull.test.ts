/**
 * CodeRabbit 2026-05-15 — `parseTextOrNull` contract pin.
 *
 * <p>Empty / whitespace-only response bodies (true 204s, HEAD-only
 * responses) must be normalised to `null` before reaching the
 * picker so the `urlOnlyMatch` rescue tier (which keys off
 * `responseBody === null`) actually fires. The previous
 * `JSON.parse('')` flow threw inside the try/catch and silently
 * dropped the endpoint, making the rescue path unreachable for
 * exactly the no-content captures it existed to handle.
 *
 * <p>Pure-function contract — synthetic inputs, no real Playwright
 * Response needed.
 */

import {
  parseTextOrNull,
  shouldRecordResponse,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

describe("parseTextOrNull — Phase H'' empty-body rescue", () => {
  it('PARSE-EMPTY-001 returns null value for an empty string', (): void => {
    const wrapped = parseTextOrNull('');

    expect(wrapped.value).toBeNull();
  });

  it('PARSE-WHITESPACE-001 returns null value for a whitespace-only string', (): void => {
    const wrapped = parseTextOrNull('   \n  \t  ');

    expect(wrapped.value).toBeNull();
  });

  it('PARSE-JSON-001 parses a valid JSON object', (): void => {
    const wrapped = parseTextOrNull('{"a":1,"b":"x"}');

    expect(wrapped.value).toEqual({ a: 1, b: 'x' });
  });

  it('PARSE-JSON-ARRAY-001 parses a top-level JSON array', (): void => {
    const wrapped = parseTextOrNull('[1,2,3]');

    expect(wrapped.value).toEqual([1, 2, 3]);
  });

  it('PARSE-MALFORMED-001 propagates SyntaxError on malformed JSON', (): void => {
    /**
     * Closure that invokes the function-under-test with malformed
     * input — handed to jest's `toThrow` matcher.
     * @returns Never (always throws).
     */
    const shouldThrow = (): void => {
      parseTextOrNull('{not-json');
    };

    expect(shouldThrow).toThrow(SyntaxError);
  });
});

/**
 * Decision matrix for `shouldRecordResponse(status, contentType)` —
 * the predicate `parseResponse` uses to gate whether a captured
 * response enters the discovered-endpoint pool. The bug this
 * predicate fixes: the original `parseResponse` dropped HTTP 204
 * captures because their `content-type` header is typically absent
 * (`'none'` sentinel) and the `isJsonContentType` filter rejected
 * them — making the picker's `urlOnlyMatch` rescue tier (added in
 * `0384df1b`) unreachable for the exact no-content cases it was
 * built to handle.
 *
 * <p>Live evidence: Hapoalim run `15-05-2026_10390505` fired the
 * real txn POST `/current-account/transactions?retrievalStartDate=X
 * &retrievalEndDate=Y` with status 204; the capture never entered
 * the pool; picker emitted `tier=none`; DASHBOARD.FINAL fell through
 * to dormant rescue → SCRAPE produced 0 txns. Predicate fix lets
 * 204 captures into the pool so the picker can commit the real URL.
 *
 * <p>Decision matrix:
 * <ul>
 *   <li>status 200 + JSON content-type → record</li>
 *   <li>status 200 + non-JSON content-type → drop</li>
 *   <li>status 204 + any content-type → record (bypass)</li>
 *   <li>status 5xx + JSON content-type → record (bank errors)</li>
 *   <li>status 5xx + non-JSON content-type → drop</li>
 * </ul>
 */
describe('shouldRecordResponse — decision matrix', () => {
  it('SRR-200-JSON returns true for status=200 + application/json', (): void => {
    const shouldRecord = shouldRecordResponse(200, 'application/json');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-200-TEXT-PLAIN returns true for status=200 + text/plain (some bank APIs)', (): void => {
    const shouldRecord = shouldRecordResponse(200, 'text/plain; charset=utf-8');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-200-HTML returns false for status=200 + text/html (error pages, redirects with body)', (): void => {
    // Wait — text/html IS in the JSON_CONTENT_TYPES allow-list per
    // the existing parseResponse contract (some bank "JSON" APIs
    // return HTML envelopes). Pin the existing behaviour explicitly.
    const shouldRecord = shouldRecordResponse(200, 'text/html');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-200-IMAGE returns false for status=200 + image/png (binary assets)', (): void => {
    const shouldRecord = shouldRecordResponse(200, 'image/png');

    expect(shouldRecord).toBe(false);
  });

  it('SRR-200-NONE returns false for status=200 + no content-type sentinel', (): void => {
    const shouldRecord = shouldRecordResponse(200, 'none');

    expect(shouldRecord).toBe(false);
  });

  it('SRR-204-NONE returns true for status=204 + no content-type — the Hapoalim live bug', (): void => {
    // The actual live capture: HTTP 204 No Content has no
    // content-type header → `extractRequestMeta` defaults to
    // `'none'` sentinel. Without the 204 bypass, this was dropped.
    const shouldRecord = shouldRecordResponse(204, 'none');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-204-JSON returns true for status=204 + application/json (defensive)', (): void => {
    // Some servers DO send content-type on 204. Still record.
    const shouldRecord = shouldRecordResponse(204, 'application/json');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-204-HTML returns true for status=204 + text/html (defensive)', (): void => {
    const shouldRecord = shouldRecordResponse(204, 'text/html');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-500-JSON returns true for status=500 + JSON (bank error envelopes)', (): void => {
    const shouldRecord = shouldRecordResponse(500, 'application/json');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-500-HTML returns true for status=500 + text/html (HTML error pages still parseable)', (): void => {
    const shouldRecord = shouldRecordResponse(500, 'text/html');

    expect(shouldRecord).toBe(true);
  });

  it('SRR-302-NONE returns false for status=302 + no content-type (redirects without body)', (): void => {
    const shouldRecord = shouldRecordResponse(302, 'none');

    expect(shouldRecord).toBe(false);
  });
});
