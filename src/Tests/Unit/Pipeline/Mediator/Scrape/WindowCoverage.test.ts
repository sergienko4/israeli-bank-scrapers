/**
 * Window-coverage reconciliation — the guardrail that compares a page against
 * the window that was requested rather than against its own body.
 *
 * The cases below encode the claims the module makes. First, coverage is only
 * ever *proved* — an empty page, and a page whose rows carry no recognised date
 * field, must both report `unproven`, because a response that says nothing
 * about the old end of the window has not served it. Second, the oldest row
 * decides, not the newest or the count, so a page dense with recent rows is
 * still unproven while a gap remains. Third, dates resolve through the shared
 * WK aliases, so a bank is covered by existing rather than by opting in.
 *
 * The Hapoalim case carries the real numbers from the captured trace that
 * motivated PR #489. Bodies are synthetic — zero PII.
 */

import {
  assessWindowCoverage,
  type IWindowArgs,
  type IWindowResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js';

/**
 * A row dated through `eventDate`, the numeric alias Hapoalim's rows carry.
 * @param yyyymmdd - Compact date the bank emits, e.g. `20260414`.
 * @returns A synthetic row.
 */
function poalimRow(yyyymmdd: string): object {
  return { eventDate: Number(yyyymmdd), eventAmount: 1 };
}

/**
 * A row dated through `transactionDate`, the ISO-style alias other banks use.
 * @param iso - Calendar day, e.g. `2026-04-14`.
 * @returns A synthetic row.
 */
function isoRow(iso: string): object {
  return { transactionDate: iso, amount: 1 };
}

/**
 * Run one reconciliation.
 * @param requestedStart - Window start the caller asked for.
 * @param rows - Rows the shape extracted.
 * @returns The verdict under test.
 */
function assess(requestedStart: string, rows: readonly object[]): IWindowResult {
  const args: IWindowArgs = { requestedStart, rows, label: 'test/txns' };
  return assessWindowCoverage(args);
}

describe('assessWindowCoverage', () => {
  it('reports covered when the oldest row reaches the requested start', () => {
    const rows = [isoRow('2026-06-01'), isoRow('2026-02-09'), isoRow('2026-04-14')];
    const result = assess('2026-02-09', rows);
    expect(result.verdict).toBe('covered');
    expect(result.gapDays).toBe(0);
  });

  it('reports covered when rows predate the requested start', () => {
    const rows = [isoRow('2026-01-02')];
    const result = assess('2026-02-09', rows);
    expect(result.verdict).toBe('covered');
  });

  it('reports unproven with the gap when the oldest row stops short', () => {
    // The captured Hapoalim window that motivated PR #489: asked from
    // 2026-02-09, oldest row returned was 2026-04-14.
    const rows = [poalimRow('20260414'), poalimRow('20260513'), poalimRow('20260601')];
    const result = assess('2026-02-09', rows);
    expect(result.verdict).toBe('unproven');
    expect(result.oldest).toBe('2026-04-14');
    expect(result.gapDays).toBe(64);
  });

  it('reports unproven for an empty page rather than vacuously covered', () => {
    const result = assess('2026-02-09', []);
    expect(result.verdict).toBe('unproven');
    expect(result.oldest).toBe('');
  });

  it('reports unproven when no row carries a recognised date field', () => {
    const rows = [{ amount: 1 }, { amount: 2 }];
    const result = assess('2026-02-09', rows);
    expect(result.verdict).toBe('unproven');
    expect(result.oldest).toBe('');
  });

  it('never lets an undateable row certify coverage for its page', () => {
    // One row reaches the start but carries no date; the datable rows do not.
    const rows = [{ amount: 1 }, isoRow('2026-04-14')];
    const result = assess('2026-02-09', rows);
    expect(result.verdict).toBe('unproven');
  });

  it('resolves dates through WK aliases across differing bank formats', () => {
    const poalim = assess('2026-02-09', [poalimRow('20260209')]);
    expect(poalim.verdict).toBe('covered');
    const iso = assess('2026-02-09', [isoRow('2026-02-09')]);
    expect(iso.verdict).toBe('covered');
  });

  it('measures the gap in calendar days when the start is an instant', () => {
    // The caller holds `options.startDate` as a Date, so the start arrives as a
    // UTC instant. Reducing only one side to a calendar day would truncate the
    // difference by a partial day and understate the gap by one.
    const start = new Date(2026, 1, 9).toISOString();
    const result = assess(start, [poalimRow('20260414')]);
    expect(result.oldest).toBe('2026-04-14');
    expect(result.gapDays).toBe(64);
  });

  it('proves the account, not the page, is the unit of the question', () => {
    // A bank that walks month by month hands back one page per month. Judged
    // alone, every page but the oldest falls short of the start by
    // construction — across the captured traces that was 31 of 69 pages — so a
    // per-page caller would warn on a complete scrape. The union is covered,
    // which is why the pipeline assesses once per account after pagination.
    const june = [isoRow('2026-06-02'), isoRow('2026-06-20')];
    const feb = [isoRow('2026-02-09'), isoRow('2026-02-25')];
    expect(assess('2026-02-09', june).verdict).toBe('unproven');
    expect(assess('2026-02-09', feb).verdict).toBe('covered');
    expect(assess('2026-02-09', [...june, ...feb]).verdict).toBe('covered');
  });
});
