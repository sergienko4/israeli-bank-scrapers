/**
 * Hapoalim transactions — the bank's own page cap, and walking past it.
 *
 * `current-account/transactions` is date-windowed, and the bank caps a
 * response SERVER-SIDE at its own `numItemsPerPage`, ignoring the larger size
 * the request asks for. It returns the most RECENT N rows and drops the rest
 * of the window on the floor — no error, no flag, just a shorter history than
 * was asked for. A busy account requesting six months got five.
 *
 * Bodies are synthetic (structural only, fake values), mirroring the captured
 * contract: a top-level `transactions[]` beside `numItemsPerPage`.
 */

import type { IHapoalimAcct } from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShapeHelpers.js';
import {
  type HapoalimCursor,
  txnsExtractPage,
  txnsUrl,
} from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShapeTxns.js';
import type { IExtractPageArgs } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const ACCT = { composite: '12-613-000000' } as unknown as IHapoalimAcct;

/**
 * Action context carrying the window the caller asked for.
 * @param startDate - Requested window start, ISO.
 * @returns A minimal context the shape reads startDate from.
 */
function ctxFrom(startDate: string): { options: { startDate: Date } } {
  return { options: { startDate: new Date(startDate) } };
}

/**
 * One synthetic row on a given YYYYMMDD date.
 * @param eventDate - Transaction date as the bank reports it.
 * @returns A synthetic transaction row.
 */
function row(eventDate: number): Record<string, unknown> {
  return { eventDate, eventAmount: 10, activityDescription: 'DEMO' };
}

/**
 * Build the extractor argument bundle.
 * @param body - Response body.
 * @param startDate - Caller's requested window start.
 * @returns Args for txnsExtractPage.
 */
function argsFor(
  body: object,
  startDate = '2026-02-20',
): IExtractPageArgs<IHapoalimAcct, HapoalimCursor> {
  return {
    body,
    cursor: false,
    acct: ACCT,
    ctx: ctxFrom(startDate),
  } as unknown as IExtractPageArgs<IHapoalimAcct, HapoalimCursor>;
}

describe('Hapoalim/transactions paging', () => {
  it('asks for another window when the bank filled the page at its own cap', () => {
    // 3 rows against a stated cap of 3 — the shape of a truncation.
    const body = {
      numItemsPerPage: 3,
      transactions: [row(20260317), row(20260401), row(20260820)],
    };
    const args = argsFor(body);
    const page = txnsExtractPage(args);
    expect(page.items.length).toBe(3);
    // Day BEFORE the oldest row, so the next window cannot repeat it.
    expect(page.nextCursor).toBe('20260316');
  });

  it('stops on a short page — the window was fully served', () => {
    const body = { numItemsPerPage: 150, transactions: [row(20260317), row(20260401)] };
    const args = argsFor(body);
    const page = txnsExtractPage(args);
    expect(page.nextCursor).toBe(false);
  });

  it('stops once the next window would start before the caller asked', () => {
    // Oldest row IS the window start, so there is nothing older to fetch.
    const body = { numItemsPerPage: 2, transactions: [row(20260220), row(20260405)] };
    const args = argsFor(body, '2026-02-20');
    const page = txnsExtractPage(args);
    expect(page.nextCursor).toBe(false);
  });

  it('stops rather than looping when a full page carries no usable date', () => {
    // Cannot walk backwards without a date. Repeating the same window forever
    // is the failure this guards.
    const body = { numItemsPerPage: 2, transactions: [{ eventAmount: 1 }, { eventAmount: 2 }] };
    const args = argsFor(body);
    const page = txnsExtractPage(args);
    expect(page.nextCursor).toBe(false);
  });

  it('does not guess a cap when the bank states none', () => {
    const body = { transactions: [row(20260317), row(20260401)] };
    const args = argsFor(body);
    const page = txnsExtractPage(args);
    expect(page.nextCursor).toBe(false);
  });

  it('returns no rows, and no cursor, for an empty response', () => {
    const args = argsFor({});
    const page = txnsExtractPage(args);
    expect(page.items.length).toBe(0);
    expect(page.nextCursor).toBe(false);
  });
});

describe('Hapoalim/transactions URL', () => {
  it('ends the first window today', () => {
    const ctx = ctxFrom('2026-02-20') as unknown as IActionContext;
    const built = txnsUrl(ACCT, false, ctx);
    const url = String(built);
    expect(url).toContain('retrievalStartDate=20260220');
    expect(url).toContain('retrievalEndDate=');
  });

  it('ends a later window where the cursor says, keeping the same start', () => {
    const cursor = '20260316' as HapoalimCursor;
    const ctx = ctxFrom('2026-02-20') as unknown as IActionContext;
    const built = txnsUrl(ACCT, cursor, ctx);
    const url = String(built);
    expect(url).toContain('retrievalEndDate=20260316');
    expect(url).toContain('retrievalStartDate=20260220');
  });
});
