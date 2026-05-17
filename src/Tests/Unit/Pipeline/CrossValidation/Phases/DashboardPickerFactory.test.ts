/**
 * Cross-bank DASHBOARD picker factory — drives every bank's captured
 * network pool through production {@link resolveTxnEndpoint} and
 * asserts the resolver commits the bank's canonical TXN endpoint
 * with the URL, method, and picker tier the production pipeline
 * relies on at DASHBOARD.FINAL time.
 *
 * <p>Pool is constructed from a PII-redacted JSON fixture per
 * scenario (see {@link loadPhaseFixture}). Each fixture's `pool`
 * mirrors what `INetworkDiscovery` accumulates by DASHBOARD.FINAL —
 * including 2xx-no-body responses (204 No Content) the picker must
 * accept per the architectural rule "any 2xx response is OK".
 *
 * <p>RED on the current tree for the `hapoalim` `204-empty-window`
 * scenario: the picker's tier discipline rejects URL-match-but-empty-
 * body captures and `resolveTxnEndpoint` returns `false`. After the
 * picker fix that lands in the next commit, the row turns GREEN with
 * tier `urlOnlyMatch` + WK-default field-map fallback. Additional
 * bank rows land in follow-up commits as regression guards.
 */

import {
  createFrozenNetwork,
  type IDiscoveredEndpoint,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { resolveTxnEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import {
  type IPhaseGFixtureCapture,
  makeBankFixture,
  PHASE_G_BANKS,
  type PhaseGBank,
} from '../../Strategy/Scrape/Fixtures/CrossBankDedup/_makeBankFixture.js';
import {
  type IPhaseHCapture,
  type IPhaseHExpected,
  loadPhaseFixture,
  type PhaseHBank,
} from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IPhaseHScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
}

/** Scenarios exercised by the DASHBOARD picker factory. */
const SCENARIOS: readonly IPhaseHScenarioRow[] = [
  { bank: 'hapoalim', scenarioId: '204-empty-window' },
  { bank: 'hapoalim', scenarioId: 'dormant-window-totals' },
];

/** Empty header map shared across synthesised endpoint entries. */
const EMPTY_HEADERS: Readonly<Record<string, string>> = {};

/**
 * Maps a fixture capture entry to a production {@link IDiscoveredEndpoint}.
 * Synthesises content-type / headers / timestamps deterministically so the
 * frozen network behaves indistinguishably from a live capture pool for
 * picker purposes.
 *
 * @param capture - One fixture capture entry.
 * @param index - Pool-relative index (used as capture index + timestamp).
 * @returns Endpoint shape consumed by {@link createFrozenNetwork}.
 */
function captureToEndpoint(capture: IPhaseHCapture, index: number): IDiscoveredEndpoint {
  return {
    ...capture,
    contentType: capture.responseBody === null ? '' : 'application/json',
    requestHeaders: EMPTY_HEADERS,
    responseHeaders: EMPTY_HEADERS,
    timestamp: index,
    captureIndex: index,
  };
}

/**
 * Builds the production-shape pool from the fixture entries. Extracted
 * so the parameterised loop body stays inside the per-method line
 * ceiling and the per-entry mapping has a named call-site.
 *
 * @param captures - Fixture capture entries.
 * @returns Endpoints consumed by {@link createFrozenNetwork}.
 */
function buildPool(captures: readonly IPhaseHCapture[]): readonly IDiscoveredEndpoint[] {
  return captures.map((capture, index): IDiscoveredEndpoint => captureToEndpoint(capture, index));
}

/**
 * Slim view of `resolveTxnEndpoint`'s success-side return value
 * relevant to factory assertions. Avoids importing the full
 * production internal type so the factory stays decoupled from
 * upstream-shape churn.
 */
interface IPhaseHResolvedEndpoint {
  readonly endpoint: { readonly url: string; readonly method: 'GET' | 'POST' };
  readonly pickerTier: string;
}

/**
 * Optional-field assertion helper — skips the assertion when the
 * expected value is undefined so a single scenario can drive multiple
 * per-phase factories without supplying every assertion field. Returns
 * `true` when the assertion ran and `false` when skipped so the caller
 * can count which fields the scenario exercised.
 *
 * <p>Arrow-function form because the project's eslint config blocks
 * `undefined` in `FunctionDeclaration` type annotations
 * (`no-restricted-syntax`); arrow expressions are exempt.
 *
 * @param actual - Production value to assert.
 * @param expected - Expected value (or `undefined` to skip).
 * @returns True when the assertion ran, false when skipped.
 */
const ASSERT_OR_SKIP = <T>(actual: T, expected: T | undefined): boolean => {
  if (expected === undefined) return false;
  expect(actual).toBe(expected);
  return true;
};

/**
 * Asserts the resolver-committed endpoint against the scenario's
 * expected fields. Returns the count of assertions actually performed
 * — varies per scenario based on which `expected.*` fields are populated.
 *
 * @param resolved - Internal endpoint emitted by {@link resolveTxnEndpoint}.
 * @param expected - Scenario expectations from the fixture metadata.
 * @returns Number of field assertions that ran for this scenario.
 */
function assertCommit(resolved: IPhaseHResolvedEndpoint, expected: IPhaseHExpected): number {
  const didUrlRun = ASSERT_OR_SKIP(resolved.endpoint.url, expected.dashboardTxnUrl);
  const didMethodRun = ASSERT_OR_SKIP(resolved.endpoint.method, expected.dashboardTxnMethod);
  const didTierRun = ASSERT_OR_SKIP(resolved.pickerTier, expected.dashboardPickerTier);
  return [didUrlRun, didMethodRun, didTierRun].filter(Boolean).length;
}

describe('DASHBOARD-PICKER-FACTORY — Phase H per-bank picker contract', () => {
  it.each(SCENARIOS)('dashboardPicker_$bank_$scenarioId_ShouldCommitEndpoint', (row): void => {
    const fixture = loadPhaseFixture(row.bank, row.scenarioId);
    const pool = buildPool(fixture.pool);
    const network = createFrozenNetwork(pool, false);
    const result = resolveTxnEndpoint(network);

    expect(result).not.toBe(false);
    if (result !== false) assertCommit(result, fixture.meta.expected);
  });
});

/**
 * Adapts a Phase G fixture capture (the PII-redacted txn-list
 * response shipped at `Strategy/Scrape/Fixtures/CrossBankDedup/`)
 * to a Phase H picker pool entry. Reuses the existing redacted body
 * so this factory does not duplicate ~5000 lines of fixture JSON.
 *
 * @param capture - Phase G capture entry.
 * @returns Phase H pool entry with status 200 (Phase G captures are
 *   populated 2xx responses).
 */
function phaseGToPhaseHCapture(capture: IPhaseGFixtureCapture): IPhaseHCapture {
  return {
    url: capture.url,
    method: capture.method,
    postData: capture.postData ?? '',
    status: 200,
    responseBody: capture.responseBody,
  };
}

/** Single-element row wrapper required by Jest's `it.each` tuple shape. */
const PHASE_G_BANK_ROWS: readonly (readonly [PhaseGBank])[] = PHASE_G_BANKS.map(
  (bank): readonly [PhaseGBank] => [bank] as const,
);

/**
 * "Rich" picker tiers — any tier other than `urlOnlyMatch` or `none`
 * indicates the picker recognized the body shape. Phase G fixtures
 * have populated bodies; the EXACT rich tier depends on method + the
 * fixture's `postData` field:
 *   `postWithShape` — POST + populated postData + body has txn array
 *   `replayablePost` — POST + populated postData + body NOT recognised
 *   `shapePassing` — body has txn array, method GET, or POST with no postData
 * The 6 cross-bank rows below assert membership in this set, not a
 * specific tier — Phase G fixtures don't all carry postData, so POST
 * banks legitimately downgrade from `postWithShape` to `shapePassing`.
 */
const RICH_PICKER_TIERS: readonly string[] = ['postWithShape', 'replayablePost', 'shapePassing'];

/**
 * Assert the Phase G regression guard for one bank fixture.
 *
 * @param bank - Phase G bank under test.
 * @returns True after the assertions complete.
 */
function assertPhaseGRegressionForBank(bank: PhaseGBank): boolean {
  const fixture = makeBankFixture(bank);
  const result = pickResultFromFixture(fixture);
  expect(result).not.toBe(false);
  if (result === false) return true;
  assertResultMatchesFixture(result, fixture);
  return true;
}

/**
 * Run the Phase G capture through the production picker.
 *
 * @param fixture - Phase G bank fixture under test.
 * @returns Picker output (or false when no endpoint resolves).
 */
function pickResultFromFixture(
  fixture: ReturnType<typeof makeBankFixture>,
): ReturnType<typeof resolveTxnEndpoint> {
  const phaseHCapture = phaseGToPhaseHCapture(fixture.capture);
  const pool = buildPool([phaseHCapture]);
  const network = createFrozenNetwork(pool, false);
  return resolveTxnEndpoint(network);
}

/**
 * Assert the picker result matches the fixture's expected URL,
 * method, and a rich picker tier.
 *
 * @param result - Picker output (must be non-false at call site).
 * @param fixture - Phase G bank fixture (URL + expectedMethod source).
 * @returns True after the assertions pass.
 */
function assertResultMatchesFixture(
  result: Exclude<ReturnType<typeof resolveTxnEndpoint>, false>,
  fixture: ReturnType<typeof makeBankFixture>,
): boolean {
  expect(result.endpoint.url).toBe(fixture.capture.url);
  expect(result.endpoint.method).toBe(fixture.meta.expectedMethod);
  expect(RICH_PICKER_TIERS).toContain(result.pickerTier);
  return true;
}

describe('DASHBOARD-PICKER-FACTORY — Phase G regression guard cross-bank', () => {
  it.each(PHASE_G_BANK_ROWS)('dashboardPicker_%s_lastGoodCapture_ShouldCommitViaRichTier', bank => {
    assertPhaseGRegressionForBank(bank);
  });
});
