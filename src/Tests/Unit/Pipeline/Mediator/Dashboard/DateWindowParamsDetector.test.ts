/**
 * Phase H'' — `detectDateWindowParams` contract.
 *
 * <p>Pure-function contract — synthetic minimal inputs, NO fixtures
 * (cross-bank happy paths via real-data fixtures are covered
 * end-to-end by the existing `CrossBankBillingCycleCatalog.test.ts`
 * shape recognisers).
 *
 * <p>The detector resolves a WK-aliased `[fromAlias, toAlias]` tuple
 * deterministically by scanning EVERY captured URL's query string
 * AND every response body's top-level keys for WK.fromDate /
 * WK.toDate aliases. The pair must be found together — if only one
 * alias is observed, the detector emits the empty tuple `[]` so
 * downstream callers can fall through to the no-window-injection
 * path. Empty input defensively returns the empty tuple.
 *
 * <p>RED today on `main`: the detector module does not exist yet →
 * suite fails to load. GREEN after the cycle-detector commit lands.
 */

import detectDateWindowParams, {
  type IDateWindowProbeInput,
} from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DateWindowParamsDetector.js';

/**
 * Minimal probe-input builder. Local to this file because the
 * detector's contract is independent of any cross-test helper.
 * @param url - Captured URL (with optional search params).
 * @param responseBody - Captured response body (any JSON value).
 * @returns Synthetic probe input.
 */
function makeProbe(url: string, responseBody: unknown): IDateWindowProbeInput {
  return { url, responseBody };
}

describe('detectDateWindowParams — Phase H second-pass contract', () => {
  it('DETECTOR-EMPTY-001 detectDateWindowParams_EmptyInput_ShouldReturnEmptyTuple', (): void => {
    const result = detectDateWindowParams([]);

    expect(result).toEqual([]);
  });

  it('DETECTOR-URL-PAIR-001 detectDateWindowParams_UrlCarriesBothAliases_ShouldReturnPair', (): void => {
    // Mirror of Hapoalim's working-run POST URL — both WK aliases
    // appear as URL search params on the captured request.
    const captures: readonly IDateWindowProbeInput[] = [
      makeProbe(
        'https://bank.example/ServerServices/current-account/transactions?retrievalStartDate=20260414&retrievalEndDate=20260514&accountId=00-000-000000&lang=he',
        { transactions: [] },
      ),
    ];

    const result = detectDateWindowParams(captures);

    expect(result).toEqual(['retrievalStartDate', 'retrievalEndDate']);
  });

  it('DETECTOR-BODY-PAIR-001 detectDateWindowParams_TopLevelBodyKeys_ShouldReturnPair', (): void => {
    // Hapoalim's `?type=totals&view=future` body exposes the date
    // window as top-level fields `startDate` / `endDate` — both are
    // WK.fromDate / WK.toDate aliases. The detector picks them up
    // even though the URL itself carries no WK aliases.
    const captures: readonly IDateWindowProbeInput[] = [
      makeProbe(
        'https://bank.example/ServerServices/current-account/transactions?accountId=00-000-000000&type=totals&view=future&lang=he',
        { startDate: 20260514, endDate: 20260531, creditEventCounter: 0 },
      ),
    ];

    const result = detectDateWindowParams(captures);

    expect(result).toEqual(['startDate', 'endDate']);
  });

  it('DETECTOR-MISS-001 detectDateWindowParams_NoAliasObserved_ShouldReturnEmptyTuple', (): void => {
    // Neither URL nor top-level body keys carry a WK.fromDate or
    // WK.toDate alias — detector returns the empty tuple.
    const captures: readonly IDateWindowProbeInput[] = [
      makeProbe('https://bank.example/api/dashboard?accountId=00-000-000000', {
        balance: 150,
        currency: 'ILS',
        accountStatus: 'active',
      }),
    ];

    const result = detectDateWindowParams(captures);

    expect(result).toEqual([]);
  });

  it('DETECTOR-PARTIAL-001 detectDateWindowParams_OnlyOneAliasObserved_ShouldReturnEmptyTuple', (): void => {
    // Defensive: only fromDate alias present without a matching
    // toDate alias — emit empty so the URL synthesizer doesn't
    // produce a half-formed window query.
    const captures: readonly IDateWindowProbeInput[] = [
      makeProbe('https://bank.example/api/txns?startDate=20260101', { transactions: [] }),
    ];

    const result = detectDateWindowParams(captures);

    expect(result).toEqual([]);
  });

  it('DETECTOR-NULL-BODY-001 detectDateWindowParams_NullResponseBody_ShouldHandleDefensively', (): void => {
    // Defensive: 204-no-body captures (responseBody === null) must
    // contribute zero body-side alias hits without throwing. The
    // sibling URL-side probe drives the eventual emit decision.
    const captures: readonly IDateWindowProbeInput[] = [
      makeProbe('https://bank.example/api/txns?other=x', null),
    ];

    const result = detectDateWindowParams(captures);

    expect(result).toEqual([]);
  });

  it('DETECTOR-MALFORMED-URL-001 detectDateWindowParams_MalformedUrl_ShouldFallThroughToBody', (): void => {
    // Defensive: a captured probe whose `url` field is not parseable
    // by `new URL(...)` must not throw — the detector falls through
    // to the response-body alias probe. Pinned so an upstream change
    // to capture-shape can't surface a regression silently.
    const captures: readonly IDateWindowProbeInput[] = [
      makeProbe('not-a-valid-url', { startDate: 20260101, endDate: 20260301 }),
    ];

    const result = detectDateWindowParams(captures);

    expect(result).toEqual(['startDate', 'endDate']);
  });
});
