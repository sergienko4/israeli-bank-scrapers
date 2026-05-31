/**
 * Phase H'' — `detectDormantEvidence` contract.
 *
 * <p>Pure-function contract — synthetic minimal inputs, NO fixtures.
 * The cross-bank dormant-pool happy path is exercised end-to-end by
 * the DASHBOARD-PICKER-FACTORY scenario `dormant-composite-empty`
 * which loads the real PII-redacted Hapoalim pool.
 *
 * <p>The detector returns true when ANY captured probe carries an
 * empty WK `txnContainers` array + a WK fromDate alias + a WK
 * toDate alias (at any body depth) — proof the bank reported a
 * date-window state rather than a missing endpoint. Used by
 * DASHBOARD.FINAL to flip fail-loud to commit-empty for the
 * dormant-account case.
 */

import detectDormantEvidence, {
  type IDormantProbeInput,
} from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DormantEvidenceDetector.js';

/**
 * Minimal probe-input builder. Local to this file because the
 * detector's contract reads only the body field.
 * @param responseBody - Captured response body (any JSON value).
 * @returns Synthetic probe input.
 */
function makeProbe(responseBody: unknown): IDormantProbeInput {
  return { responseBody };
}

describe("detectDormantEvidence — Phase H'' contract", () => {
  it('DORMANT-EMPTY-001 detectDormantEvidence_EmptyPool_ShouldReturnFalse', (): void => {
    const isDormant = detectDormantEvidence([]);

    expect(isDormant).toBe(false);
  });

  it('DORMANT-HAPOALIM-001 detectDormantEvidence_HapoalimCompositeBody_ShouldReturnTrue', (): void => {
    // Mirror of the real Hapoalim composite/myAccount body captured
    // in login-POST for a dormant account: nested empty transactions
    // array + retrievalStartDate / retrievalEndDate at depth 4.
    const probe = makeProbe({
      homePageTiltes: [
        {
          balance: 0,
          source: 'currentAccount',
          data: {
            retrievalTransactionData: {
              retrievalStartDate: 0,
              retrievalEndDate: 0,
              eventCounter: 0,
            },
            transactions: [],
          },
        },
      ],
    });

    const isDormant = detectDormantEvidence([probe]);

    expect(isDormant).toBe(true);
  });

  it('DORMANT-FLAT-001 detectDormantEvidence_FlatBodyEmptyContainer_ShouldReturnTrue', (): void => {
    // Bank emits a flat body: top-level `transactions: []` + WK
    // fromDate/toDate aliases. Still hits — detector is depth-agnostic.
    const probe = makeProbe({
      transactions: [],
      fromDate: 20260415,
      toDate: 20260515,
    });

    const isDormant = detectDormantEvidence([probe]);

    expect(isDormant).toBe(true);
  });

  it('DORMANT-NO-CONTAINER-001 detectDormantEvidence_NoEmptyContainer_ShouldReturnFalse', (): void => {
    // Body carries date-window aliases but NO WK txnContainers key
    // (or non-empty container) — not enough signal for dormant state.
    const probe = makeProbe({
      balance: 150,
      retrievalStartDate: 20260415,
      retrievalEndDate: 20260515,
    });

    const isDormant = detectDormantEvidence([probe]);

    expect(isDormant).toBe(false);
  });

  it('DORMANT-NO-DATES-001 detectDormantEvidence_EmptyContainerNoDates_ShouldReturnFalse', (): void => {
    // Body carries an empty WK txnContainer but NO WK fromDate/toDate
    // aliases — could be a structural empty body (cold start), not a
    // dormant date-window state. Detector stays conservative.
    const probe = makeProbe({
      transactions: [],
      balance: 0,
    });

    const isDormant = detectDormantEvidence([probe]);

    expect(isDormant).toBe(false);
  });

  it('DORMANT-DEPTH-LIMIT-001 detectDormantEvidence_TooDeeplyNested_ShouldFallThrough', (): void => {
    // Defensive: a captured body that buries the dormant signal
    // beyond MAX_SCAN_DEPTH (6) must NOT be misclassified as
    // dormant — the detector falls through. Pinned so the depth
    // budget can't silently widen and start producing false
    // positives for deeply-nested bank schemas.
    const buried = makeProbe({
      l1: { l2: { l3: { l4: { l5: { l6: { l7: { transactions: [] } } } } } } },
    });

    const isDormant = detectDormantEvidence([buried]);

    expect(isDormant).toBe(false);
  });

  it('DORMANT-NON-OBJECT-001 detectDormantEvidence_NonObjectBody_ShouldHandleDefensively', (): void => {
    // Mixed pool with null/array/scalar bodies + one valid dormant
    // body. The detector must skip non-object entries without
    // throwing, then still hit on the valid probe.
    const probes: readonly IDormantProbeInput[] = [
      makeProbe(null),
      makeProbe([1, 2, 3]),
      makeProbe('not-an-object'),
      makeProbe({ transactions: [], fromDate: 1, toDate: 2 }),
    ];

    const isDormant = detectDormantEvidence(probes);

    expect(isDormant).toBe(true);
  });
});
