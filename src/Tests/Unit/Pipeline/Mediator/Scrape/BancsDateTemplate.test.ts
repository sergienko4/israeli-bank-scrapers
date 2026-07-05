/**
 * BaNCS (Yahav) date-range replay templating — synthetic, PII-free.
 *
 * <p>Proves {@link applyBancsChunkRange} rewrites a captured BaNCS
 * CURRENT_ACCOUNT query's two `OrigDt` bounds (from = GREATERTHAN*,
 * to = LESSTHAN*) with the iteration's month chunk, preserves the
 * envelope `Ver` markers, skips nodes with an unclassifiable operator or
 * no `OrigDt`, and default-denies (returns `false`, leaves the body
 * byte-identical) for a non-BaNCS body. Also proves {@link isRangeIterable}
 * now routes a BaNCS txn body through the monthly-chunk replay while
 * still rejecting the portfolioBalance body and preserving the existing
 * flat-WK-date behaviour.
 *
 * Every value is fabricated — no real account data appears.
 */

import applyBancsChunkRange from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsDateTemplate.js';
import type { JsonRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplayAction.js';
import { isRangeIterable } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplayAction.js';

/** Feb-2026 month chunk (UTC ISO), the window to substitute in. */
const FEB_2026 = { start: '2026-02-01T00:00:00.000Z', end: '2026-02-28T23:59:59.000Z' };

/** Read-back shape for asserting the rewritten inner filter nodes. */
interface IReadNode {
  readonly Operator: string;
  readonly OrigDt?: Record<string, number | string>;
}

/** Read-back shape for the whole BaNCS envelope. */
interface IReadBody {
  readonly Payload: { readonly Filters: readonly { readonly Filters: readonly IReadNode[] }[] };
}

/**
 * Build one BaNCS inner filter node with a captured (pre-rewrite) date.
 * @param operator - The BaNCS range operator tagging this bound.
 * @param day - Captured day-of-month (fabricated; expected overwritten).
 * @returns A synthetic inner-filter record carrying a `Ver` marker.
 */
function filterNode(operator: string, day: number): JsonRecord {
  return { Ver: 'v1', OrigDt: { Ver: 'v1', Day: day, Month: 6, Year: 2025 }, Operator: operator };
}

/**
 * Build a captured CURRENT_ACCOUNT txn body with a from/to range.
 * @returns A synthetic BaNCS transactions request body.
 */
function bancsTxnBody(): JsonRecord {
  const from = filterNode('GREATERTHANOREQUAL', 5);
  const to = filterNode('LESSTHANOREQUAL', 25);
  return { Payload: { Category: ['CURRENT_ACCOUNT'], Filters: [{ Filters: [from, to] }] } };
}

/**
 * Deep-clone a body and read its inner filter nodes for assertions.
 * @param body - The (already-mutated) request body.
 * @returns The inner `Payload.Filters[0].Filters` records.
 */
function readInnerNodes(body: JsonRecord): readonly IReadNode[] {
  const serialized = JSON.stringify(body);
  const parsed = JSON.parse(serialized) as IReadBody;
  return parsed.Payload.Filters[0].Filters;
}

/**
 * Today's calendar parts — the test-side expected value for the to-bound
 * cap (mirrors the production `todayDatePart` local-calendar extraction).
 * @returns Today as `{Day,Month,Year}`.
 */
function todayParts(): { Day: number; Month: number; Year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  return { Day: now.getDate(), Month: month, Year: now.getFullYear() };
}

describe('BancsDateTemplate — applyBancsChunkRange (default-deny write)', () => {
  it('when_bancs_txn_body_should_rewrite_from_bound_to_chunk_start', () => {
    const body = bancsTxnBody();
    const isBancs = applyBancsChunkRange(body, FEB_2026);
    expect(isBancs).toBe(true);
    const nodes = readInnerNodes(body);
    expect(nodes).toContainEqual({
      Ver: 'v1',
      Operator: 'GREATERTHANOREQUAL',
      OrigDt: { Ver: 'v1', Day: 1, Month: 2, Year: 2026 },
    });
  });

  it('when_bancs_txn_body_should_rewrite_to_bound_to_chunk_end', () => {
    const body = bancsTxnBody();
    applyBancsChunkRange(body, FEB_2026);
    const nodes = readInnerNodes(body);
    expect(nodes).toContainEqual({
      Ver: 'v1',
      Operator: 'LESSTHANOREQUAL',
      OrigDt: { Ver: 'v1', Day: 28, Month: 2, Year: 2026 },
    });
  });

  it('when_captured_year_is_overwritten_should_not_leak_old_dates', () => {
    const body = bancsTxnBody();
    applyBancsChunkRange(body, FEB_2026);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('2025');
  });

  it('when_body_is_not_bancs_should_default_deny_and_not_mutate', () => {
    const body: JsonRecord = { fromDate: '2020-01-01', toDate: '2020-02-01' };
    const before = JSON.stringify(body);
    const isBancs = applyBancsChunkRange(body, FEB_2026);
    const after = JSON.stringify(body);
    expect(isBancs).toBe(false);
    expect(after).toBe(before);
  });

  it('when_a_node_lacks_origdt_should_rewrite_only_the_dated_bound', () => {
    const fromNoDt: JsonRecord = { Operator: 'GREATERTHANOREQUAL' };
    const to = filterNode('LESSTHANOREQUAL', 25);
    const body: JsonRecord = {
      Payload: { Category: ['CURRENT_ACCOUNT'], Filters: [{ Filters: [fromNoDt, to] }] },
    };
    const isBancs = applyBancsChunkRange(body, FEB_2026);
    expect(isBancs).toBe(true);
    const nodes = readInnerNodes(body);
    expect(nodes).toContainEqual({ Operator: 'GREATERTHANOREQUAL' });
    expect(nodes).toContainEqual({
      Ver: 'v1',
      Operator: 'LESSTHANOREQUAL',
      OrigDt: { Ver: 'v1', Day: 28, Month: 2, Year: 2026 },
    });
  });

  it('when_operator_is_unknown_should_leave_that_node_untouched', () => {
    const from = filterNode('GREATERTHANOREQUAL', 5);
    const other = filterNode('EQUALS', 9);
    const body: JsonRecord = {
      Payload: { Category: ['CURRENT_ACCOUNT'], Filters: [{ Filters: [from, other] }] },
    };
    applyBancsChunkRange(body, FEB_2026);
    const nodes = readInnerNodes(body);
    expect(nodes).toContainEqual({
      Ver: 'v1',
      Operator: 'EQUALS',
      OrigDt: { Ver: 'v1', Day: 9, Month: 6, Year: 2025 },
    });
  });
});

describe('BancsDateTemplate — to-bound capped at today', () => {
  it('when_chunk_end_is_in_the_future_should_cap_the_to_bound_at_today', () => {
    const body = bancsTxnBody();
    const futureChunk = { start: '2026-07-01T00:00:00.000Z', end: '2999-12-31T23:59:59.000Z' };
    applyBancsChunkRange(body, futureChunk);
    const nodes = readInnerNodes(body);
    const today = todayParts();
    expect(nodes).toContainEqual({
      Ver: 'v1',
      Operator: 'LESSTHANOREQUAL',
      OrigDt: { Ver: 'v1', Day: today.Day, Month: today.Month, Year: today.Year },
    });
  });

  it('when_chunk_end_is_in_the_past_should_keep_the_chunk_end_verbatim', () => {
    const body = bancsTxnBody();
    const pastChunk = { start: '2000-01-01T00:00:00.000Z', end: '2000-01-31T23:59:59.000Z' };
    applyBancsChunkRange(body, pastChunk);
    const nodes = readInnerNodes(body);
    expect(nodes).toContainEqual({
      Ver: 'v1',
      Operator: 'LESSTHANOREQUAL',
      OrigDt: { Ver: 'v1', Day: 31, Month: 1, Year: 2000 },
    });
  });
});

describe('BancsDateTemplate — isRangeIterable routing (default-deny)', () => {
  it('when_bancs_txn_body_should_be_range_iterable', () => {
    const body = bancsTxnBody();
    const isRange = isRangeIterable(body);
    expect(isRange).toBe(true);
  });

  it('when_portfolio_balance_body_should_not_be_range_iterable', () => {
    const body: JsonRecord = { Payload: { Category: ['portfolioBalance'] } };
    const isRange = isRangeIterable(body);
    expect(isRange).toBe(false);
  });

  it('when_flat_wk_date_body_should_stay_range_iterable', () => {
    const body: JsonRecord = { fromDate: '2020-01-01', toDate: '2020-02-01' };
    const isRange = isRangeIterable(body);
    expect(isRange).toBe(true);
  });
});
