/**
 * E2E-real transaction logging — unit coverage for the newest-first row
 * ordering and the PII masking applied to every logged row.
 *
 * <p>Guards a real misread: card scrapers emit transactions grouped by
 * billing cycle, so in emission order the last printed row is the open
 * cycle's *oldest* entry. A CI log tail then reads as though recent
 * transactions were missing when they are present a few rows above.
 *
 * Fixtures are synthetic and carry zero PII.
 */

import { jest } from '@jest/globals';

import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import type { ITransaction } from '../../Transactions.js';
import { logScrapedTransactions } from '../E2eReal/Helpers.js';

const ACCOUNT_NUMBER = '1234567';
const DESCRIPTION = 'corner-shop';

// Cycle-grouped emission order: the newest cycle is emitted last and
// descends within itself, so the final entry is not the newest date.
const CYCLE_GROUPED = ['2026-06-30', '2026-06-02', '2026-07-28', '2026-07-02'];

// Same order with an unparseable date wedged between the two cycles.
const WITH_UNDATED = ['2026-06-02', 'not-a-date', '2026-07-28'];

/**
 * Build a synthetic transaction carrying only the logged fields.
 * @param date - ISO transaction date.
 * @returns Transaction record.
 */
function txn(date: string): ITransaction {
  return { date, description: DESCRIPTION, originalAmount: 1234 } as ITransaction;
}

/**
 * Wrap transactions in a single-account scraper result.
 * @param dates - ISO dates, in the order the scraper emitted them.
 * @returns Scraper result.
 */
function resultWith(dates: readonly string[]): IScraperScrapingResult {
  const txns = dates.map(txn);
  const account = { accountNumber: ACCOUNT_NUMBER, txns };
  return { success: true, accounts: [account] };
}

/**
 * Capture the account block logged for the given emission order.
 * @param result - Scraper result to log.
 * @returns The logged block.
 */
function blockOf(result: IScraperScrapingResult): string {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  logScrapedTransactions(result);
  const block = String(spy.mock.calls[0][0]);
  spy.mockRestore();
  return block;
}

/**
 * Capture the account block logged for the given emission order.
 * @param dates - ISO dates, in scraper emission order.
 * @returns The logged block.
 */
function blockFor(dates: readonly string[]): string {
  const result = resultWith(dates);
  return blockOf(result);
}

/**
 * Transaction rows of the block, header stripped.
 * @param dates - ISO dates, in scraper emission order.
 * @returns Row lines.
 */
function rowsFor(dates: readonly string[]): string[] {
  const block = blockFor(dates);
  return block.split('\n').slice(2);
}

describe('logScrapedTransactions row ordering', () => {
  it('prints the newest transaction first, not the last emitted one', () => {
    const rows = rowsFor(CYCLE_GROUPED);
    expect(rows[0]).toContain('28.7.2026');
  });

  it('ends on the oldest transaction, never mid-cycle', () => {
    const rows = rowsFor(CYCLE_GROUPED);
    expect(rows[rows.length - 1]).toContain('2.6.2026');
  });

  it('leaves the scraper-returned array order untouched', () => {
    const result = resultWith(CYCLE_GROUPED);
    const before = result.accounts?.[0].txns.map(t => t.date);
    blockOf(result);
    const after = result.accounts?.[0].txns.map(t => t.date);
    expect(after).toEqual(before);
  });

  it('still orders valid rows when an undated row sits between them', () => {
    const rows = rowsFor(WITH_UNDATED);
    expect(rows[0]).toContain('28.7.2026');
    expect(rows[1]).toContain('2.6.2026');
  });

  it('ranks an undated row oldest instead of tying the comparator', () => {
    const rows = rowsFor(WITH_UNDATED);
    const last = rows[rows.length - 1];
    expect(last).not.toContain('2026');
  });
});

describe('logScrapedTransactions header', () => {
  it('reports the oldest..newest ISO span alongside the count', () => {
    const block = blockFor(CYCLE_GROUPED);
    expect(block).toContain('4 txns | 2026-06-02 .. 2026-07-28');
  });

  it('falls back to a placeholder when nothing carries a date', () => {
    const block = blockFor([]);
    expect(block).toContain('0 txns | no dates');
  });

  it('masks the account number in the header', () => {
    const block = blockFor(CYCLE_GROUPED);
    const header = block.split('\n')[1];
    expect(header).not.toContain(ACCOUNT_NUMBER);
  });
});

describe('logScrapedTransactions masking', () => {
  it('masks the amount and description on every row', () => {
    const rows = rowsFor(CYCLE_GROUPED);
    const joined = rows.join('\n');
    expect(joined).not.toContain(DESCRIPTION);
    expect(joined).not.toContain('1234');
  });
});
