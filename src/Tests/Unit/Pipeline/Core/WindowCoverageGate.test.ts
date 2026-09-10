/**
 * The E2E coverage gate's own tests.
 *
 * <p>The gate itself only runs against live banks behind credentials, so it
 * would otherwise ship unverified — the exact shape of oversight that let
 * issue #553 through a green CI in the first place. These exercise its two
 * decisions on fixtures: a missing verdict is a regression, an unproven one is
 * the provider's behaviour on the day.
 */

import type { ITransactionsAccount } from '../../../../Transactions.js';
import type { IWindowCoverage } from '../../../../WindowCoverage.js';
import { inspectWindowCoverage } from '../../../E2eReal/WindowCoverageGate.js';

/**
 * A minimal account carrying an optional verdict.
 * @param accountNumber - Identifier reported back by the gate.
 * @param windowCoverage - Verdict to attach, omitted to simulate a regression.
 * @returns An account shaped enough for the gate.
 */
function account(accountNumber: string, windowCoverage?: IWindowCoverage): ITransactionsAccount {
  const base = { accountNumber, txns: [] };
  if (windowCoverage === undefined) return base;
  return { ...base, windowCoverage };
}

const COVERED: IWindowCoverage = {
  status: 'covered',
  requestedStart: '2026-01-01',
  oldest: '2026-01-01',
};

const UNPROVEN: IWindowCoverage = {
  status: 'unproven',
  requestedStart: '2026-01-01',
  oldest: '2026-03-01',
  reason: 'boundDidNotMove',
};

const CAVEATED: IWindowCoverage = {
  status: 'lowerBoundReached',
  requestedStart: '2026-01-01',
  oldest: '2026-01-01',
  caveats: ['mappingRejectedRows'],
};

describe('e2e/window-coverage gate', () => {
  it('passes silently when every account proved its window', () => {
    const report = inspectWindowCoverage([account('1', COVERED), account('2', COVERED)]);
    expect(report).toEqual({ missing: [], warnings: [] });
  });

  it('names every account that published no verdict', () => {
    const accounts = [account('1', COVERED), account('2'), account('3')];
    const report = inspectWindowCoverage(accounts);
    expect(report.missing).toEqual(['2', '3']);
  });

  it('warns rather than fails when a window could not be proven', () => {
    const report = inspectWindowCoverage([account('1', UNPROVEN)]);
    expect(report.missing).toEqual([]);
    expect(report.warnings).toHaveLength(1);
  });

  /**
   * The status that looks like success and is not: the far edge was reached,
   * but a channel reported loss. Staying silent here would rebuild the exact
   * blind spot the gate exists to close.
   */
  it('warns when the edge was reached but a channel reported loss', () => {
    const report = inspectWindowCoverage([account('1', CAVEATED)]);
    expect(report.missing).toEqual([]);
    const line = report.warnings[0];
    expect(line).toContain('mappingRejectedRows');
  });

  it('says why the window is unproven, not just that it is', () => {
    const report = inspectWindowCoverage([account('7', UNPROVEN)]);
    const line = report.warnings[0];
    expect(line).toContain('boundDidNotMove');
    expect(line).toContain('7');
  });
});
