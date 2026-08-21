/**
 * Overlap collapse — removing only the rows a second request re-served.
 *
 * The distinction that matters here is multiset versus set. Two genuinely
 * distinct purchases can serialize identically (same day, same merchant, same
 * amount), and a set difference would delete one of them. These cases pin that
 * behaviour, because the loss would be silent and indistinguishable from the
 * truncation the backfill exists to fix.
 */

import { dropOverlap } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/RawOverlap.js';

/**
 * One synthetic raw row.
 * @param date - Row date.
 * @param amount - Row amount.
 * @returns A raw row as a shape would extract it.
 */
function row(date: string, amount: number): object {
  return { date, amount, description: 'DEMO' };
}

const LABEL = 'demoBank/txns';

describe('dropOverlap/re-served rows', () => {
  it('drops rows the earlier request already delivered', () => {
    const collected = [row('2026-04-01', 10), row('2026-04-02', 20)];
    const incoming = [row('2026-04-02', 20), row('2026-03-30', 30)];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.dropped).toBe(1);
    expect(result.kept).toEqual([row('2026-03-30', 30)]);
  });

  it('keeps everything when the windows did not overlap', () => {
    const collected = [row('2026-04-01', 10)];
    const incoming = [row('2026-03-30', 30), row('2026-03-29', 40)];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.dropped).toBe(0);
    expect(result.kept).toHaveLength(2);
  });

  it('recognises a re-served row whose fields arrived in a different order', () => {
    // Identity is the row's data, not its serialization. A provider is free to
    // emit the same row's keys in a different order between two replies, and
    // insertion-order serialization would then read it as fresh and hand the
    // caller the same transaction twice.
    const collected = [{ date: '2026-04-02', amount: 20, description: 'DEMO' }];
    const incoming = [{ description: 'DEMO', amount: 20, date: '2026-04-02' }];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.dropped).toBe(1);
    expect(result.kept).toEqual([]);
  });

  it('looks past field order in nested objects too', () => {
    const collected = [{ id: 1, meta: { a: 'x', b: 'y' } }];
    const incoming = [{ meta: { b: 'y', a: 'x' }, id: 1 }];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.dropped).toBe(1);
  });

  it('keeps everything when nothing has been collected yet', () => {
    const incoming = [row('2026-04-01', 10)];
    const result = dropOverlap({ collected: [], incoming, label: LABEL });
    expect(result.kept).toHaveLength(1);
  });
});

describe('dropOverlap/identical but distinct rows', () => {
  it('keeps a second identical row when the provider sent two', () => {
    // Two identical coffees on one day. A set difference would lose one.
    const collected = [row('2026-04-01', 10)];
    const incoming = [row('2026-04-01', 10), row('2026-04-01', 10)];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.dropped).toBe(1);
    expect(result.kept).toHaveLength(1);
  });

  it('cancels copy for copy when both sides hold duplicates', () => {
    const collected = [row('2026-04-01', 10), row('2026-04-01', 10)];
    const incoming = [row('2026-04-01', 10), row('2026-04-01', 10)];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.dropped).toBe(2);
    expect(result.kept).toHaveLength(0);
  });

  it('does not spend an allowance twice across different rows', () => {
    const collected = [row('2026-04-01', 10)];
    const incoming = [row('2026-04-01', 10), row('2026-04-01', 11)];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.kept).toEqual([row('2026-04-01', 11)]);
  });
});

describe('dropOverlap/row identity', () => {
  it('treats rows differing in any field as distinct', () => {
    const collected = [{ id: 1, note: 'a' }];
    const incoming = [{ id: 1, note: 'b' }];
    const result = dropOverlap({ collected, incoming, label: LABEL });
    expect(result.dropped).toBe(0);
  });

  it('handles an empty incoming page without error', () => {
    const result = dropOverlap({ collected: [row('2026-04-01', 10)], incoming: [], label: LABEL });
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toBe(0);
  });
});
