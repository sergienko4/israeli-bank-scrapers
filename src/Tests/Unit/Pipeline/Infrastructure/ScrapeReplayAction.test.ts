/**
 * Unit tests for ScrapeReplayAction — template replacement + monthly chunks.
 */

import type { JsonRecord } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplayAction.js';
import {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
  isRangeIterable,
  replaceField,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeReplayAction.js';

describe('replaceField', () => {
  it('replaces matching top-level field', () => {
    const body: JsonRecord = { accountId: 'OLD' };
    const isChanged = replaceField(body, ['accountId'], 'NEW');
    expect(isChanged).toBe(true);
    expect(body.accountId).toBe('NEW');
  });

  it('replaces case-insensitively', () => {
    const body: JsonRecord = { AccountID: 'OLD' };
    const isChanged = replaceField(body, ['accountId'], 'NEW');
    expect(isChanged).toBe(true);
    expect(body.AccountID).toBe('NEW');
  });

  it('returns false when no matching field', () => {
    const body: JsonRecord = { foo: 'bar' };
    const isChanged = replaceField(body, ['accountId'], 'NEW');
    expect(isChanged).toBe(false);
  });

  it('replaces nested field via BFS', () => {
    const body: JsonRecord = { outer: { inner: { accountId: 'OLD' } } };
    const isChanged = replaceField(body, ['accountId'], 'NEW');
    expect(isChanged).toBe(true);
  });
});

describe('buildMonthBody', () => {
  it('replaces accountId token', () => {
    const template = JSON.stringify({ accountId: 'X', month: '1', year: '2025' });
    const result = buildMonthBody({ template, accountId: 'A1', month: 4, year: 2026 });
    expect(result.accountId).toBe('A1');
  });

  it('replaces month + year tokens', () => {
    const template = JSON.stringify({ accountId: 'X', month: '1', year: '2025' });
    const result = buildMonthBody({ template, accountId: 'A1', month: 5, year: 2026 });
    expect(result.month).toBe('5');
    expect(result.year).toBe('2026');
  });

  it('composes DD/MM/YYYY into compositeDate field', () => {
    const template = JSON.stringify({ accountId: 'X', billingDate: '01/01/2024' });
    const result = buildMonthBody({ template, accountId: 'A1', month: 3, year: 2026 });
    expect(result.billingDate).toBe('01/03/2026');
  });

  describe('shape-aware substitution from accountRecord', () => {
    it('substitutes scalar field whose name matches a body key', () => {
      const template = JSON.stringify({
        card4Number: '0000',
        companyCode: 0,
        billingMonth: '01/01/2024',
      });
      const accountRecord = { cardSuffix: '8912', companyCode: '77' };
      const result = buildMonthBody({
        template,
        accountId: '8912',
        month: 6,
        year: 2026,
        accountRecord,
      });
      expect(result.card4Number).toBe('8912');
      expect(result.companyCode).toBe(77);
      expect(result.billingMonth).toBe('01/06/2026');
    });

    it('coerces string→number, number→string, number→boolean per body type', () => {
      const template = JSON.stringify({
        a: 0,
        b: '',
        c: false,
        billingMonth: '01/01/2024',
      });
      const accountRecord = { a: '42', b: 7, c: 1 };
      const result = buildMonthBody({
        template,
        accountId: 'X',
        month: 1,
        year: 2026,
        accountRecord,
      });
      expect(result.a).toBe(42);
      expect(result.b).toBe('7');
      expect(result.c).toBe(true);
    });

    it('skips reserved monthly keys so it does not fight the WK substitution', () => {
      const template = JSON.stringify({ accountId: 'X', month: '1', year: '2025' });
      const accountRecord = { accountId: 'shouldNotOverride', month: '99', year: '9999' };
      const result = buildMonthBody({
        template,
        accountId: 'A1',
        month: 6,
        year: 2026,
        accountRecord,
      });
      expect(result.accountId).toBe('A1');
      expect(result.month).toBe('6');
      expect(result.year).toBe('2026');
    });

    it('ignores nested-object record values (only scalar fields substitute)', () => {
      const template = JSON.stringify({
        someField: 'keep',
        billingMonth: '01/01/2024',
      });
      const accountRecord = { someField: { nested: 'x' } } as unknown as Readonly<
        Record<string, unknown>
      >;
      const result = buildMonthBody({
        template,
        accountId: 'X',
        month: 1,
        year: 2026,
        accountRecord,
      });
      expect(result.someField).toBe('keep');
    });

    it('matches body key case-insensitively', () => {
      const template = JSON.stringify({ CompanyCode: 0, billingMonth: '01/01/2024' });
      const accountRecord = { companyCode: '11' };
      const result = buildMonthBody({
        template,
        accountId: 'X',
        month: 1,
        year: 2026,
        accountRecord,
      });
      expect(result.CompanyCode).toBe(11);
    });

    it('preserves body boolean type when record value is also boolean (no coercion)', () => {
      const template = JSON.stringify({ isPartner: false, billingMonth: '01/01/2024' });
      const accountRecord = { isPartner: true };
      const result = buildMonthBody({
        template,
        accountId: 'X',
        month: 1,
        year: 2026,
        accountRecord,
      });
      expect(result.isPartner).toBe(true);
    });

    it('skips body keys with no matching record key', () => {
      const template = JSON.stringify({ unrelatedField: 'keep', billingMonth: '01/01/2024' });
      const accountRecord = { totallyDifferentKey: 'ignored' };
      const result = buildMonthBody({
        template,
        accountId: 'X',
        month: 1,
        year: 2026,
        accountRecord,
      });
      expect(result.unrelatedField).toBe('keep');
    });
  });
});

describe('isMonthlyEndpoint', () => {
  it('returns false for empty POST data', () => {
    const isMonthlyEndpointResult1 = isMonthlyEndpoint('');
    expect(isMonthlyEndpointResult1).toBe(false);
  });

  it('returns false for unparsable JSON', () => {
    const isMonthlyEndpointResult2 = isMonthlyEndpoint('{not json');
    expect(isMonthlyEndpointResult2).toBe(false);
  });

  it('returns true when body has month + year fields', () => {
    const body = JSON.stringify({ month: 1, year: 2026 });
    const isMonthlyEndpointResult3 = isMonthlyEndpoint(body);
    expect(isMonthlyEndpointResult3).toBe(true);
  });

  it('returns true when body has a composite date field', () => {
    const body = JSON.stringify({ billingDate: '01/01/2024' });
    const isMonthlyEndpointResult4 = isMonthlyEndpoint(body);
    expect(isMonthlyEndpointResult4).toBe(true);
  });
});

describe('isRangeIterable', () => {
  it('returns true when body has from + to fields', () => {
    const body: JsonRecord = { fromDate: '2026-01-01', toDate: '2026-01-31' };
    const isRangeIterableResult5 = isRangeIterable(body);
    expect(isRangeIterableResult5).toBe(true);
  });

  it('returns false when body has no date range', () => {
    const body: JsonRecord = { accountId: 'A1' };
    const isRangeIterableResult6 = isRangeIterable(body);
    expect(isRangeIterableResult6).toBe(false);
  });
});

describe('generateMonthChunks', () => {
  it('generates one chunk for same-month start/end', () => {
    const start = new Date(2026, 3, 1);
    const end = new Date(2026, 3, 30);
    const chunks = generateMonthChunks(start, end);
    expect(chunks.length).toBe(1);
    expect(chunks[0].start).toContain('2026-04-01');
  });

  it('generates multiple chunks spanning months', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 2, 31);
    const chunks = generateMonthChunks(start, end);
    expect(chunks.length).toBe(3);
  });

  it('caps end to today when end is in future and no futureMonths', () => {
    const start = new Date(2026, 0, 1);
    const future = new Date(2100, 11, 31);
    const chunks = generateMonthChunks(start, future);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('extends end when futureMonths is provided', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 31);
    const chunks = generateMonthChunks(start, end, 3);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ── Extended: Base64 paging + range iterable + replace-in-nested ────

describe('replaceField — Base64 paging context', () => {
  it('replaces in decoded Base64 paging context', () => {
    const decoded = JSON.stringify({ fromDate: 'OLD' });
    const encoded = Buffer.from(decoded, 'utf-8').toString('base64');
    const body: JsonRecord = { pagingContext: encoded };
    const isChanged = replaceField(body, ['fromDate'], 'NEW');
    expect(isChanged).toBe(true);
    // The pagingContext should still be a string (re-encoded).
    expect(typeof body.pagingContext).toBe('string');
  });

  it('returns false when Base64 context has no matching field', () => {
    const decoded = JSON.stringify({ other: 'value' });
    const encoded = Buffer.from(decoded, 'utf-8').toString('base64');
    const body: JsonRecord = { pagingContext: encoded };
    const isChanged = replaceField(body, ['fromDate'], 'NEW');
    expect(isChanged).toBe(false);
  });

  it('handles invalid Base64 paging context value gracefully', () => {
    const body: JsonRecord = { pagingContext: '!!!not-base64!!!' };
    const isChanged = replaceField(body, ['fromDate'], 'NEW');
    expect(isChanged).toBe(false);
  });
});

describe('isRangeIterable — via Base64 paging', () => {
  it('returns true when decoded paging context has from + to', () => {
    const decoded = JSON.stringify({ fromDate: '2026-01-01', toDate: '2026-01-31' });
    const encoded = Buffer.from(decoded, 'utf-8').toString('base64');
    const body: JsonRecord = { pagingContext: encoded };
    const isRangeIterableResult7 = isRangeIterable(body);
    expect(isRangeIterableResult7).toBe(true);
  });
});

describe('isMonthlyEndpoint — deeper paths', () => {
  it('returns true with year alone + composite date', () => {
    const body = JSON.stringify({ year: 2026, billingDate: '01/01/2024' });
    const isMonthlyEndpointResult8 = isMonthlyEndpoint(body);
    expect(isMonthlyEndpointResult8).toBe(true);
  });

  it('returns false when neither month/year nor composite date', () => {
    const body = JSON.stringify({ accountId: 'A1' });
    const isMonthlyEndpointResult9 = isMonthlyEndpoint(body);
    expect(isMonthlyEndpointResult9).toBe(false);
  });
});

describe('replaceField — exhaustion', () => {
  it('handles deeply nested object traversal', () => {
    const body: JsonRecord = {
      l1: { l2: { l3: { accountId: 'OLD' } } },
    };
    const isChanged = replaceField(body, ['accountId'], 'NEW');
    expect(isChanged).toBe(true);
  });

  it('handles arrays of objects', () => {
    const body: JsonRecord = {
      items: [{ other: 1 }, { accountId: 'OLD' }],
    };
    const isChanged = replaceField(body, ['accountId'], 'NEW');
    expect(isChanged).toBe(true);
  });
});

// ── PR #281 C8 branch coverage: isJsonRecord type guard + Set lookup ──

describe('isMonthlyEndpoint — isJsonRecord type guard branches', () => {
  it('returns false when JSON parses to a primitive (string)', () => {
    const isResult1 = isMonthlyEndpoint('"just-a-string"');
    expect(isResult1).toBe(false);
  });

  it('returns false when JSON parses to a number', () => {
    const isResult2 = isMonthlyEndpoint('42');
    expect(isResult2).toBe(false);
  });

  it('returns false when JSON parses to null', () => {
    const isResult3 = isMonthlyEndpoint('null');
    expect(isResult3).toBe(false);
  });

  it('returns false when JSON parses to a boolean', () => {
    const isResult4 = isMonthlyEndpoint('true');
    expect(isResult4).toBe(false);
  });

  it('returns false when JSON parses to an array (Array.isArray guard)', () => {
    const isResult5 = isMonthlyEndpoint('[1, 2, 3]');
    expect(isResult5).toBe(false);
  });
});

describe('isRangeIterable — Set-based lookup branches (SQ-3 fix)', () => {
  it('matches FROM/TO with mixed-case field names via toLowerCase Set', () => {
    const body: JsonRecord = { FROMDATE: '2026-01-01', toDATE: '2026-01-31' };
    const isResult6 = isRangeIterable(body);
    expect(isResult6).toBe(true);
  });

  it('returns false when only FROM is present (toLowerCase Set miss for TO)', () => {
    const body: JsonRecord = { fromDate: '2026-01-01' };
    const isResult7 = isRangeIterable(body);
    expect(isResult7).toBe(false);
  });

  it('returns false for body with non-date fields only (Set-has rejects)', () => {
    const body: JsonRecord = { someOther: 'x', AnotherField: 1 };
    const isResult8 = isRangeIterable(body);
    expect(isResult8).toBe(false);
  });
});
