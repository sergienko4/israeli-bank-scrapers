/**
 * Month-chunk generation — the live Yahav request planner.
 * Covers range validation, month boundaries and the future-month cap.
 */

import { jest } from '@jest/globals';

import { generateMonthChunks } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/MonthChunking.js';
import requireMonthChunks from '../../../../Helpers/MonthChunkPlan.js';

describe('generateMonthChunks', () => {
  it('generates monthly chunks from Feb 2026 to Mar 2026', () => {
    const generated = generateMonthChunks(new Date('2026-02-01'), new Date('2026-03-24'));
    const chunks = requireMonthChunks(generated);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].start).toContain('2026-02');
    expect(chunks[1].start).toContain('2026-03');
  });

  it('generates single chunk for same month', () => {
    const generated = generateMonthChunks(new Date('2026-03-01'), new Date('2026-03-24'));
    const chunks = requireMonthChunks(generated);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toContain('2026-03');
  });

  it('rejects a reversed range within one bank month', () => {
    const start = new Date('2026-03-20T10:00:00.000Z');
    const end = new Date('2026-03-10T10:00:00.000Z');
    const chunks = generateMonthChunks(start, end);
    expect(chunks).toBe(false);
  });

  it('caps end date chunk to actual end date (not end of month)', () => {
    const generated = generateMonthChunks(new Date('2026-02-01'), new Date('2026-03-15'));
    const chunks = requireMonthChunks(generated);
    const lastChunk = chunks.at(-1);
    expect(lastChunk).toBeDefined();
    expect(lastChunk?.end).toContain('2026-03-15');
  });

  it('generates 12 chunks for a full year', () => {
    const generated = generateMonthChunks(new Date('2025-04-01'), new Date('2026-03-24'));
    const chunks = requireMonthChunks(generated);
    expect(chunks).toHaveLength(12);
  });

  it('CAL-RANGE-01 rejects an ancient range before month-chunk expansion', () => {
    const start = new Date('0042-03-01T10:00:00.000Z');
    const end = new Date('2026-03-15T10:00:00.000Z');
    const chunks = generateMonthChunks(start, end);
    expect(chunks).toBe(false);
  });

  it('rejects an invalid end even when future months are requested', () => {
    const chunks = generateMonthChunks(new Date('2026-03-01'), new Date('invalid'), 1);
    expect(chunks).toBe(false);
  });

  it('caps a future end to today in the bank calendar', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-24T10:00:00.000Z'));
    try {
      const future = new Date('2027-06-15T12:00:00.000Z');
      const generated = generateMonthChunks(new Date('2026-01-01T12:00:00.000Z'), future);
      const lastChunk = requireMonthChunks(generated).at(-1);
      expect(lastChunk?.end).toBe('2026-03-24T23:59:59.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('extends the end when future months are requested', () => {
    const start = new Date('2026-01-01T12:00:00.000Z');
    const end = new Date('2026-01-31T12:00:00.000Z');
    const generated = generateMonthChunks(start, end, 3);
    const chunks = requireMonthChunks(generated);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
