/**
 * Pure-unit tests for the BillingCycleCatalogDetector.
 *
 * <p>Exercises the SHAPE recognisers in isolation with synthetic
 * minimal inputs (no fixtures). Each recogniser case asserts the
 * canonical {@link IBillingCycleCatalog} output produced for the
 * known per-bank shape.
 *
 * <p>Commit 1 ships these tests RED — the detector stub returns
 * {@link none} for all inputs. Commit 4 registers the Backbase /
 * Max / VisaCal recognisers and flips them GREEN.
 */

import {
  detectBillingCycleCatalog,
  type IPreNavCapture,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/BillingCycleCatalogDetector.js';
import { isSome, type Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IBillingCycleCatalog } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const STUB_URL = 'https://stub.example/api';

/** Sentinel empty catalog used by {@link unwrapForAssertion} on miss. */
const EMPTY_CATALOG: IBillingCycleCatalog = { cycles: [] };

/**
 * Wrap a synthetic body in the {@link IPreNavCapture} shape.
 *
 * @param body - Synthetic response body.
 * @returns A capture record with a stub URL and the given body.
 */
function capture(body: unknown): IPreNavCapture {
  return { url: STUB_URL, responseBody: body };
}

/**
 * Unwrap a detector result for assertion. Returns the sentinel
 * {@link EMPTY_CATALOG} on miss so downstream `expect()` calls
 * can read `.cycles.length` etc. without dereferencing
 * {@link Option}.
 *
 * @param option - Option returned by the detector.
 * @returns Underlying catalog or the empty sentinel.
 */
function unwrapForAssertion(option: Option<IBillingCycleCatalog>): IBillingCycleCatalog {
  if (!option.has) return EMPTY_CATALOG;
  return option.value;
}

describe('BillingCycleCatalogDetector — Backbase shape', () => {
  it('[SHAPE-DETECT-BACKBASE] Detector_BackbaseBillingsForMonthsOverview_ShouldEmitCatalogWithOpenAndClosedCycles', () => {
    const body = {
      data: [
        { billingDate: '06/2026', isFinalBillingDate: false },
        { billingDate: '05/2026', isFinalBillingDate: true },
        { billingDate: '04/2026', isFinalBillingDate: true },
      ],
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const isSomeResult = isSome(result);
    expect(isSomeResult).toBe(true);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBe(3);
    expect(catalog.cycles[0]?.isOpen).toBe(true);
    expect(catalog.cycles[1]?.isOpen).toBe(false);
    expect(catalog.cycles[2]?.isOpen).toBe(false);
  });
});

describe('BillingCycleCatalogDetector — Max shape', () => {
  it('[SHAPE-DETECT-MAX] Detector_MaxCycleSummary_ShouldEmitCatalogWithIsOpenFromIsFinnal', () => {
    const body = {
      Result: {
        UserCards: {
          Cards: [
            {
              Last4Digits: 'FAKE_C09',
              CycleSummary: [
                { Date: '2026-06-02T00:00:00', IsFinnal: false },
                { Date: '2026-05-02T00:00:00', IsFinnal: true },
              ],
            },
          ],
        },
      },
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const isSomeResult = isSome(result);
    expect(isSomeResult).toBe(true);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBe(2);
    expect(catalog.cycles[0]?.isOpen).toBe(true);
    expect(catalog.cycles[1]?.isOpen).toBe(false);
  });
});

describe('BillingCycleCatalogDetector — VisaCal shape', () => {
  it('[SHAPE-DETECT-VISACAL] Detector_VisaCalBigNumbers_ShouldEmitPerCardCatalog', () => {
    const body = {
      result: {
        bigNumbers: [
          {
            debitDate: '2026-05-15T00:00:00',
            prevDebitDate: '2026-04-15T00:00:00',
            cards: [
              {
                cardUniqueId: 'FAKE_CARD_VISACAL_01',
                nextDebit: { debitDate: '2026-05-15T00:00:00' },
                additionalInfo: {
                  cycleOpeningDate: '2026-04-15T00:00:00',
                  cycleClosingDate: '2026-05-14T00:00:00',
                },
              },
            ],
          },
        ],
      },
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const isSomeResult = isSome(result);
    expect(isSomeResult).toBe(true);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBeGreaterThan(0);
    const openCycles = catalog.cycles.filter((c): boolean => c.isOpen);
    expect(openCycles.length).toBeGreaterThan(0);
  });
});

describe('BillingCycleCatalogDetector — default-deny + edge cases', () => {
  it('[SHAPE-DETECT-EMPTY] Detector_EmptyBuffer_ShouldReturnNone', () => {
    const result = detectBillingCycleCatalog([]);
    expect(result.has).toBe(false);
  });

  it('[SHAPE-DETECT-NONE] Detector_UnrelatedBuffer_ShouldReturnNone', () => {
    const body = { foo: 'bar', accounts: [{ id: 'A1' }] };
    const result = detectBillingCycleCatalog([capture(body)]);
    expect(result.has).toBe(false);
  });

  it('[SHAPE-DETECT-BACKBASE-MALFORMED] Detector_BackbaseDataNotArray_ShouldReturnNone', () => {
    const result = detectBillingCycleCatalog([capture({ data: 'not-an-array' })]);
    expect(result.has).toBe(false);
  });

  it('[SHAPE-DETECT-BACKBASE-ENTRY-MALFORMED] Detector_BackbaseEntryMissingFields_SkippedSilently', () => {
    const body = {
      data: [
        { billingDate: '06/2026' },
        { isFinalBillingDate: false },
        null,
        { billingDate: '05/2026', isFinalBillingDate: true },
      ],
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBe(1);
  });

  it('[SHAPE-DETECT-MAX-MALFORMED] Detector_MaxNoCards_ShouldReturnNone', () => {
    const body = { Result: { UserCards: { Summary: [] } } };
    const result = detectBillingCycleCatalog([capture(body)]);
    expect(result.has).toBe(false);
  });

  it('[SHAPE-DETECT-MAX-CARDS-MALFORMED] Detector_MaxCardWithoutCycleSummary_SkippedSilently', () => {
    const body = {
      Result: {
        UserCards: {
          Cards: [
            { Last4Digits: 'FAKE_C0X' },
            { Last4Digits: 'FAKE_C0Y', CycleSummary: [{ Date: '2026-06-02', IsFinnal: false }] },
          ],
        },
      },
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBe(1);
  });

  it('[SHAPE-DETECT-MAX-ENTRY-MALFORMED] Detector_MaxEntryMissingFields_SkippedSilently', () => {
    const body = {
      Result: {
        UserCards: {
          Cards: [
            {
              CycleSummary: [
                { Date: '2026-06-02' },
                { IsFinnal: false },
                { Date: '2026-05-02', IsFinnal: true },
              ],
            },
          ],
        },
      },
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBe(1);
  });

  it('[SHAPE-DETECT-VISACAL-MALFORMED] Detector_VisaCalNoBigNumbers_ShouldReturnNone', () => {
    const result = detectBillingCycleCatalog([capture({ result: { other: true } })]);
    expect(result.has).toBe(false);
  });

  it('[SHAPE-DETECT-VISACAL-PARTIAL] Detector_VisaCalOnlyPrevDebitDate_HarvestsClosedCycle', () => {
    const body = {
      result: {
        bigNumbers: [
          { prevDebitDate: '2026-04-15T00:00:00' },
          null,
          { debitDate: '2026-05-15T00:00:00' },
        ],
      },
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBe(2);
    const openCycles = catalog.cycles.filter((c): boolean => c.isOpen);
    expect(openCycles.length).toBe(1);
  });

  it('[SHAPE-DETECT-CAPTURE-MALFORMED] Detector_BodyNotObject_ShouldReturnNone', () => {
    const result = detectBillingCycleCatalog([
      capture('not-an-object'),
      capture(null),
      capture(42),
    ]);
    expect(result.has).toBe(false);
  });

  it('[SHAPE-DETECT-MAX-DEDUPE] Detector_MaxDuplicateDates_DedupedToCanonicalCycles', () => {
    const body = {
      Result: {
        UserCards: {
          Cards: [
            {
              CycleSummary: [
                { Date: '2026-06-02', IsFinnal: false },
                { Date: '2026-06-02', IsFinnal: false },
                { Date: '2026-06-02', IsFinnal: false },
              ],
            },
          ],
        },
      },
    };
    const result = detectBillingCycleCatalog([capture(body)]);
    const catalog = unwrapForAssertion(result);
    expect(catalog.cycles.length).toBe(1);
  });

  it('[SHAPE-DETECT-MULTI] Detector_MultipleCandidateShapes_ShouldReturnFirstMatchDeterministically', () => {
    const backbase = capture({
      data: [{ billingDate: '06/2026', isFinalBillingDate: false }],
    });
    const max = capture({
      Result: {
        UserCards: {
          Cards: [{ CycleSummary: [{ Date: '2026-06-02', IsFinnal: false }] }],
        },
      },
    });
    const buffer = [backbase, max];
    const first = detectBillingCycleCatalog(buffer);
    const second = detectBillingCycleCatalog(buffer);
    expect(first).toEqual(second);
    const isSomeFirst = isSome(first);
    expect(isSomeFirst).toBe(true);
  });
});
