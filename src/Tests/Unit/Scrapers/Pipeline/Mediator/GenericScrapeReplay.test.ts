/**
 * Tests for generic scrape replay — Capture → Template → Replay.
 * Covers both GET (URL template) and POST (body template) strategies.
 */

import {
  generateMonthChunks,
  isRangeIterable,
  replaceField,
} from '../../../../../Scrapers/Pipeline/Mediator/GenericScrapeStrategy.js';

describe('replaceField', () => {
  it('replaces a WellKnown field by name', () => {
    const body: Record<string, unknown> = { cardUniqueId: '4054', month: 3 };
    const didReplace = replaceField(body, ['cardUniqueId', 'accountId'], '9999');
    expect(didReplace).toBe(true);
    expect(body.cardUniqueId).toBe('9999');
  });

  it('returns false when no field matches', () => {
    const body: Record<string, unknown> = { someOtherField: 'abc' };
    const didReplace = replaceField(body, ['cardUniqueId', 'accountId'], '9999');
    expect(didReplace).toBe(false);
  });

  it('replaces the FIRST matching field name', () => {
    const body: Record<string, unknown> = { accountId: '111', cardUniqueId: '222' };
    const didReplace = replaceField(body, ['accountId', 'cardUniqueId'], '999');
    expect(didReplace).toBe(true);
    expect(body.accountId).toBe('999');
    expect(body.cardUniqueId).toBe('222');
  });
});

describe('POST body template for VisaCal pattern', () => {
  it('templates account ID into captured POST body', () => {
    const capturedBody = {
      cardUniqueId: '4054',
      fromDate: '2026-01-01',
      toDate: '2026-03-24',
      transactionType: 'ALL',
    };
    const body = { ...capturedBody };
    replaceField(body, ['cardUniqueId', 'accountId'], '0067');
    expect(body.cardUniqueId).toBe('0067');
    expect(body.fromDate).toBe('2026-01-01');
  });

  it('templates multiple accounts from same captured body', () => {
    const capturedBody = {
      cardUniqueId: '4054',
      fromDate: '2026-01-01',
    };
    const accountIds = ['4054', '0067', '3020', '3308'];
    const bodies = accountIds.map((id): Record<string, unknown> => {
      const body = { ...capturedBody };
      replaceField(body, ['cardUniqueId', 'accountId'], id);
      return body;
    });
    expect(bodies[0].cardUniqueId).toBe('4054');
    expect(bodies[1].cardUniqueId).toBe('0067');
    expect(bodies[2].cardUniqueId).toBe('3020');
    expect(bodies[3].cardUniqueId).toBe('3308');
  });
});

describe('isRangeIterable', () => {
  it('returns true when body has both fromDate and toDate WK fields', () => {
    const body = { fromTransDate: '2025-03-24', toTransDate: '2026-03-24', other: 'x' };
    const isRange = isRangeIterable(body);
    expect(isRange).toBe(true);
  });

  it('returns true with different date field names', () => {
    const body = { fromDate: '2025-01-01', toDate: '2026-01-01' };
    const isRange = isRangeIterable(body);
    expect(isRange).toBe(true);
  });

  it('returns false when only fromDate exists (no toDate)', () => {
    const body = { fromTransDate: '2025-03-24', cardId: '123' };
    const isRange = isRangeIterable(body);
    expect(isRange).toBe(false);
  });

  it('returns false when neither fromDate nor toDate exists', () => {
    const body = { cardUniqueId: '123', month: '3', year: '2026' };
    const isRange = isRangeIterable(body);
    expect(isRange).toBe(false);
  });
});

describe('generateMonthChunks', () => {
  it('generates monthly chunks from Feb 2026 to Mar 2026', () => {
    const chunks = generateMonthChunks(new Date('2026-02-01'), new Date('2026-03-24'));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].start).toContain('2026-02');
    expect(chunks[1].start).toContain('2026-03');
  });

  it('generates single chunk for same month', () => {
    const chunks = generateMonthChunks(new Date('2026-03-01'), new Date('2026-03-24'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toContain('2026-03');
  });

  it('caps end date chunk to actual end date (not end of month)', () => {
    const chunks = generateMonthChunks(new Date('2026-02-01'), new Date('2026-03-15'));
    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();
    expect(lastChunk?.end).toContain('2026-03-15');
  });

  it('generates 12 chunks for a full year', () => {
    const chunks = generateMonthChunks(new Date('2025-04-01'), new Date('2026-03-24'));
    expect(chunks).toHaveLength(12);
  });

  it('caps future end date to today (within 24h tolerance)', () => {
    const future = new Date('2027-06-15');
    const chunks = generateMonthChunks(new Date('2026-01-01'), future);
    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();
    const lastEnd = new Date(lastChunk?.end ?? '');
    const oneDayMs = 86400000;
    const lastEndMs = lastEnd.getTime();
    const cutoffMs = Date.now() + oneDayMs;
    expect(lastEndMs).toBeLessThanOrEqual(cutoffMs);
  });
});
