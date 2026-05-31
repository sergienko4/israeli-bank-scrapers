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
/** One row of the `shouldRecordResponse` decision matrix. The `note`
 *  column carries the load-bearing WHY for rows whose intent isn't
 *  obvious from the (status, contentType, expected) triple alone
 *  (e.g. the live-Hapoalim 204+`none` bug, the HTML-envelope JSON
 *  contract). */
interface IShouldRecordCase {
  readonly id: string;
  readonly status: number;
  readonly contentType: string;
  readonly expected: boolean;
  readonly note: string;
}

const SHOULD_RECORD_CASES: readonly IShouldRecordCase[] = [
  { id: 'SRR-200-JSON', status: 200, contentType: 'application/json', expected: true, note: '' },
  {
    id: 'SRR-200-TEXT-PLAIN',
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    expected: true,
    note: 'some bank APIs use text/plain',
  },
  {
    id: 'SRR-200-HTML',
    status: 200,
    contentType: 'text/html',
    expected: true,
    note: 'HTML-envelope JSON APIs (some banks wrap JSON in HTML)',
  },
  {
    id: 'SRR-200-IMAGE',
    status: 200,
    contentType: 'image/png',
    expected: false,
    note: 'binary assets',
  },
  {
    id: 'SRR-200-NONE',
    status: 200,
    contentType: 'none',
    expected: false,
    note: 'no content-type sentinel',
  },
  {
    id: 'SRR-204-NONE',
    status: 204,
    contentType: 'none',
    expected: true,
    note: 'Hapoalim live bug — 204 No Content has no content-type header, must bypass JSON filter',
  },
  {
    id: 'SRR-204-JSON',
    status: 204,
    contentType: 'application/json',
    expected: true,
    note: 'defensive — some servers DO send content-type on 204',
  },
  {
    id: 'SRR-204-HTML',
    status: 204,
    contentType: 'text/html',
    expected: true,
    note: 'defensive — 204 bypass applies regardless of content-type',
  },
  {
    id: 'SRR-500-JSON',
    status: 500,
    contentType: 'application/json',
    expected: true,
    note: 'bank error envelopes are still recordable',
  },
  {
    id: 'SRR-500-HTML',
    status: 500,
    contentType: 'text/html',
    expected: true,
    note: 'HTML error pages still parseable per the allow-list',
  },
  {
    id: 'SRR-302-NONE',
    status: 302,
    contentType: 'none',
    expected: false,
    note: 'redirects without body',
  },
];

describe('shouldRecordResponse — decision matrix', () => {
  it.each(SHOULD_RECORD_CASES)(
    '$id returns $expected for status=$status + contentType=$contentType ($note)',
    (testCase: IShouldRecordCase): void => {
      const shouldRecord = shouldRecordResponse(testCase.status, testCase.contentType);
      expect(shouldRecord).toBe(testCase.expected);
    },
  );
});
