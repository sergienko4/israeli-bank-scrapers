/**
 * The window verdict must survive the trip from scrape state to the public
 * result — the seam issue #553 reports as broken.
 *
 * <p>`toResult` is the only place a Pipeline account becomes something a
 * caller can hold, and it rebuilds accounts on the way through to fold in the
 * BALANCE-RESOLVE map. A rebuild that forgets a field loses it silently: the
 * result still type-checks, still reports `success: true`, and still carries
 * the transactions, so nothing above notices. These cases pin the field
 * through both branches of that rebuild.
 */

import { toResult } from '../../../../Scrapers/Pipeline/Core/PipelineResult.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { IWindowCoverage } from '../../../../WindowCoverage.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** A verdict distinctive enough that a stale or fabricated one is visible. */
const VERDICT: IWindowCoverage = {
  status: 'unproven',
  reason: 'backfillCeilingReached',
  requestedStart: '2026-01-01T00:00:00.000Z',
  oldest: '2026-02-14',
  gapDays: 44,
};

/**
 * A context whose scrape slot holds one audited account.
 * @param balances - BALANCE-RESOLVE overrides to apply, keyed by account.
 * @returns Pipeline context ready for {@link toResult}.
 */
function ctxWith(balances: ReadonlyMap<string, number>): IPipelineContext {
  const account = { accountNumber: 'A1', txns: [], windowCoverage: VERDICT };
  return {
    ...makeMockContext(),
    scrape: some({ accounts: [account] }),
    balanceResolution: some(balances),
  };
}

/**
 * Read the verdict off the first account of a public result.
 *
 * Answers `'absent'` rather than nothing when the field did not survive, so a
 * lost verdict fails the assertion with the reason spelled out.
 *
 * @param balances - BALANCE-RESOLVE overrides to apply.
 * @returns The verdict the caller would receive, or `'absent'`.
 */
function verdictFromResult(balances: ReadonlyMap<string, number>): IWindowCoverage | 'absent' {
  const ctx = ctxWith(balances);
  const proc = succeed(ctx);
  const result = toResult(proc);
  const accounts = result.success ? (result.accounts ?? []) : [];
  const carriers = accounts.filter((a): boolean => 'windowCoverage' in a);
  const verdicts = carriers.map((a): IWindowCoverage | 'absent' => a.windowCoverage ?? 'absent');
  return verdicts.length > 0 ? verdicts[0] : 'absent';
}

describe('toResult/window verdict', () => {
  it('hands the caller the verdict the scrape produced', () => {
    const verdict = verdictFromResult(new Map());
    expect(verdict).toEqual(VERDICT);
  });

  it('keeps the verdict when BALANCE-RESOLVE rebuilds the account', () => {
    // The override branch spreads the account into a new object. A rebuild
    // that listed fields by hand instead would drop the verdict here and
    // nowhere else, which is precisely the kind of loss #553 describes.
    const overrides = new Map([['A1', 1234.5]]);
    const verdict = verdictFromResult(overrides);
    expect(verdict).toEqual(VERDICT);
  });
});

/**
 * Issue #553 also asked for `diagnostics` on the pipeline's result. The
 * pipeline does carry a diagnostics state — but every field `IScraperDiagnostics`
 * needs is set once at construction and never written again: `loginUrl` stays
 * `''`, `finalUrl`/`pageTitle`/`fetchStartMs` stay absent, `lastAction` stays
 * `'init (...)'`, and nothing anywhere pushes a warning.
 *
 * <p>Publishing that object would not be reporting diagnostics, it would be
 * inventing them — an empty `warnings` array read as "no warnings" is the same
 * lie `futureDebits` tells by always being absent. So the result deliberately
 * carries no `diagnostics`, and this pins the decision: anyone wiring the
 * state through has to make the fields true first, and will land here.
 */
describe('toResult/diagnostics', () => {
  it('publishes no diagnostics rather than an unpopulated one', () => {
    const ctx = ctxWith(new Map());
    const proc = succeed(ctx);
    const result = toResult(proc);
    expect(result.diagnostics).toBeUndefined();
  });
});
