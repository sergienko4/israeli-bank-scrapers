/**
 * The walk-order guard is actually wired into the transactions extractor.
 *
 * `HapoalimWalkGuard` is covered thoroughly on its own, but that coverage says
 * nothing about whether anything calls it. The guard reports and never repairs,
 * so removing its single call site changes no return value and no other test
 * notices — the extractor keeps producing identical pages while the detection
 * silently stops existing. These cases read the warning itself, through the
 * real extractor, so the wiring cannot be removed without going red.
 *
 * Bodies are synthetic (structural only, fake values), matching the sibling
 * paging suite.
 */

import { jest } from '@jest/globals';

/** Single logger instance shared by the module under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * The guard derives its logger from `import.meta.url`.
   * @returns The shared mock logger, so its calls are visible here.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's full surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const SHAPE =
  await import('../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShapeTxns.js');

/** Argument bundle the extractor takes. */
type ExtractArgs = Parameters<typeof SHAPE.txnsExtractPage>[0];

/**
 * Every warning message emitted so far, joined for a substring assertion.
 * @returns The text of all warnings this test produced.
 */
function warnings(): string {
  const calls = LOG.warn.mock.calls as unknown[][];
  const rendered = calls.map((call: unknown[]) => JSON.stringify(call));
  return rendered.join('\n');
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
 * @param dates - Transaction dates the page carried, as the bank reports them.
 * @param cursor - Day the request ended on.
 * @param pageSize - Page size the bank states, which decides fullness.
 * @returns Args for txnsExtractPage.
 */
function argsFor(dates: readonly number[], cursor: string, pageSize = 150): ExtractArgs {
  const transactions = dates.map(row);
  const body = { numItemsPerPage: pageSize, transactions };
  const ctx = { options: { startDate: new Date('2026-02-20') } };
  const acct = { composite: '12-613-000000' };
  return { body, cursor, acct, ctx } as unknown as ExtractArgs;
}

beforeEach(() => {
  LOG.warn.mockClear();
  LOG.debug.mockClear();
});

describe('Hapoalim/transactions — walk-order guard wiring', () => {
  it('warns when a cursor page stops short of the day it asked from', () => {
    // Asked for [start, 20260401]; the newest row returned is older, so rows
    // between the two were withheld.
    const args = argsFor([20260301, 20260310], '20260401');
    SHAPE.txnsExtractPage(args);
    const said = warnings();
    expect(said).toContain('walk-order');
  });

  it('warns when a full page holds only its cursor day', () => {
    // Two rows against a stated cap of two, all on the cursor day: the next
    // request would repeat this window unchanged.
    const args = argsFor([20260401, 20260401], '20260401', 2);
    SHAPE.txnsExtractPage(args);
    const said = warnings();
    expect(said).toContain('cursor cannot advance');
  });

  it('stays quiet when the last page holds only its cursor day', () => {
    // The window held nothing older than the cursor, so the page comes back
    // short and the walk ends. This is how every normal walk finishes, and it
    // reaches the guard with oldest === newest === the cursor — the shape an
    // earlier revision warned on, firing on healthy traffic.
    const args = argsFor([20260225], '20260225');
    const page = SHAPE.txnsExtractPage(args);
    expect(page.nextCursor).toBe(false);
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('stays quiet on a full first page that reached the requested start', () => {
    // The cap counts rows, so it can cut through the start day; the walk
    // recovers the withheld rows by re-asking that day inclusively. Warning
    // here would fire on the shape HapoalimTxnPaging pins as healthy.
    const args = argsFor([20260220, 20260405], false as unknown as string, 2);
    SHAPE.txnsExtractPage(args);
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('stays quiet on a page that walked backwards as expected', () => {
    const args = argsFor([20260301, 20260401], '20260401');
    SHAPE.txnsExtractPage(args);
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('still returns the page it was given while reporting a fault', () => {
    // The guard reports and never repairs: rows already gathered are worth more
    // than the report, so a warning must not cost the caller its transactions.
    const args = argsFor([20260301, 20260310], '20260401');
    const page = SHAPE.txnsExtractPage(args);
    expect(page.items).toHaveLength(2);
  });
});
