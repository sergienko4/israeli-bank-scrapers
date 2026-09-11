/**
 * The E2E coverage gate's own tests.
 *
 * <p>The gate itself only runs against live banks behind credentials, so it
 * would otherwise ship unverified — the exact shape of oversight that let
 * issue #553 through a green CI in the first place. These exercise its two
 * decisions on fixtures: a missing verdict is a regression, an unproven one is
 * the provider's behaviour on the day.
 */

import { jest } from '@jest/globals';

import type { ITransactionsAccount } from '../../../../Transactions.js';
import type { IWindowCoverage } from '../../../../WindowCoverage.js';
import {
  assertWindowCoverage,
  inspectWindowCoverage,
} from '../../../E2eReal/WindowCoverageGate.js';

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

/** Distinct accounts whose masked hints stay distinguishable. */
const ACCT_1 = '12-345-6780001';
const ACCT_2 = '12-345-6780002';
const ACCT_3 = '12-345-6780003';

/** A realistic Israeli account number — never allowed to reach CI output. */
const RAW_ACCOUNT = '12-345-6789012';

/**
 * Everything the gate would print for one account, as a single string.
 * @param coverage - Verdict to attach, omitted to simulate a regression.
 * @returns The gate's whole rendered output.
 */
function gateOutputFor(coverage?: IWindowCoverage): string {
  const report = inspectWindowCoverage([account(RAW_ACCOUNT, coverage)]);
  return [...report.missing, ...report.warnings, ...report.information].join('\n');
}

/** Console calls emitted by one gate assertion. */
interface IEmittedChannels {
  readonly warnings: number;
  readonly information: number;
}

/**
 * Run the real assertion while suppressing and counting its console output.
 * @param coverage - Verdict to route through the E2E gate.
 * @returns Number of calls made to each severity channel.
 */
function emittedChannelsFor(coverage: IWindowCoverage): IEmittedChannels {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const information = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  try {
    assertWindowCoverage([account(RAW_ACCOUNT, coverage)]);
    return { warnings: warning.mock.calls.length, information: information.mock.calls.length };
  } finally {
    warning.mockRestore();
    information.mockRestore();
  }
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

const AUDIT_UNAVAILABLE: IWindowCoverage = {
  status: 'lowerBoundReached',
  requestedStart: '2026-01-01',
  oldest: '2026-01-01',
  caveats: ['extractionAuditUnavailable'],
};

const MIXED_CAVEATS: IWindowCoverage = {
  status: 'lowerBoundReached',
  requestedStart: '2026-01-01',
  oldest: '2026-01-01',
  caveats: ['extractionAuditUnavailable', 'mappingRejectedRows'],
};

describe('e2e/window-coverage gate', () => {
  it('passes silently when every account proved its window', () => {
    const report = inspectWindowCoverage([account('1', COVERED), account('2', COVERED)]);
    expect(report).toEqual({ missing: [], warnings: [], information: [] });
  });

  it('names every account that published no verdict', () => {
    const accounts = [account(ACCT_1, COVERED), account(ACCT_2), account(ACCT_3)];
    const report = inspectWindowCoverage(accounts);
    expect(report.missing).toEqual(['****0002', '****0003']);
  });

  it('reports an unproven window without turning routine uncertainty yellow', () => {
    const report = inspectWindowCoverage([account('1', UNPROVEN)]);
    expect(report.missing).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.information).toHaveLength(1);
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

  it('reports an unavailable audit as information rather than observed loss', () => {
    const report = inspectWindowCoverage([account('1', AUDIT_UNAVAILABLE)]);
    expect(report.warnings).toEqual([]);
    expect(report.information[0]).toContain('extractionAuditUnavailable');
  });

  it('separates mixed caveats into their own severity channels', () => {
    const report = inspectWindowCoverage([account('1', MIXED_CAVEATS)]);
    expect(report.warnings[0]).toContain('mappingRejectedRows');
    expect(report.warnings[0]).not.toContain('extractionAuditUnavailable');
    expect(report.information[0]).toContain('extractionAuditUnavailable');
    expect(report.information[0]).not.toContain('mappingRejectedRows');
  });

  it('says why the window is unproven, not just that it is', () => {
    const report = inspectWindowCoverage([account(RAW_ACCOUNT, UNPROVEN)]);
    const line = report.information[0];
    expect(line).toContain('boundDidNotMove');
    expect(line).toContain('****9012');
  });

  it('emits direct loss through warn and uncertainty through info', () => {
    const directLoss = emittedChannelsFor(CAVEATED);
    const uncertainty = emittedChannelsFor(UNPROVEN);
    expect(directLoss).toEqual({ warnings: 1, information: 0 });
    expect(uncertainty).toEqual({ warnings: 0, information: 1 });
  });

  it('emits both summaries once when one verdict carries mixed caveats', () => {
    const channels = emittedChannelsFor(MIXED_CAVEATS);
    expect(channels).toEqual({ warnings: 1, information: 1 });
  });
  /**
   * Every output channel names the account and reaches CI: `missing` through
   * the failed assertion, direct loss through `console.warn`, and uncertainty
   * through `console.info`. E2E-real uses real account numbers, and its logs
   * are retained build artifacts.
   */
  it('never prints a raw account number in the missing-verdict output', () => {
    const rendered = gateOutputFor(undefined);
    const hasRaw = rendered.includes(RAW_ACCOUNT);
    expect(hasRaw).toBe(false);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('never prints a raw account number in shortfall output', () => {
    const rendered = gateOutputFor(UNPROVEN);
    const hasRaw = rendered.includes(RAW_ACCOUNT);
    expect(hasRaw).toBe(false);
    expect(rendered.length).toBeGreaterThan(0);
  });
});
