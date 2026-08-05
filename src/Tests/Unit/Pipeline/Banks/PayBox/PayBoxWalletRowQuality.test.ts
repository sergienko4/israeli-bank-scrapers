/**
 * PayBox wallet-row QUALITY regressions — the layer that was missing.
 *
 * Existing PayBox coverage asserts that rows are *fetched* and that the
 * cursor helper behaves in isolation. Neither answers the two questions a
 * consumer actually cares about:
 *
 *   1. Is every scraped row DISTINCT? (`/getUserHistory` re-serves page 0
 *      when it does not honour the `ts` cursor, and `fetchPaginated`
 *      concatenates pages blindly — so every row was emitted twice.)
 *   2. Does every scraped row carry a HUMAN-READABLE description?
 *      (`??` only falls back on null/undefined, so a present-but-empty
 *      `merchantName` made the `text` fallback unreachable.)
 *
 * Both defects survived every existing suite and only surfaced in a live
 * run, which is exactly what this file exists to prevent.
 */

import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import type { IPayBoxAcct } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeHelpers.js';
import { mapWalletTxn } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeMap.js';
import { txnsExtractPage } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeTxns.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { ctxOf, FIXT_UID, makePayBoxBus } from './PayBoxBusFactory.js';

/** Wallet account fixture — PayBox synthesises exactly one from `uId`. */
const WALLET_ACCT: IPayBoxAcct = { accountNumber: FIXT_UID };

/** Bare action context for the pure `txnsExtractPage` unit assertions. */
const BARE_CTX = { options: { startDate: new Date('2024-01-01') } } as unknown as IActionContext;

/**
 * Three synthetic wallet rows, newest-first — the ordering
 * `/getUserHistory` uses.
 */
const PAGE_ROWS = [
  { _id: 'q-1', ts: '2026-05-14T07:00:29.037Z', amt: 12, type: 'incomingTransaction' },
  { _id: 'q-2', ts: '2026-05-13T07:00:29.037Z', amt: 34, type: 'outgoingTransaction' },
  { _id: 'q-3', ts: '2026-05-12T07:00:29.037Z', amt: 56, type: 'incomingTransaction' },
] as const;

/** Oldest ts on the page — the value the next cursor carries. */
const OLDEST_TS = PAGE_ROWS[2].ts;

/**
 * Wrap raw rows in the `/getUserHistory` response envelope.
 * @param rows - Raw wallet rows to serve.
 * @returns Response body shaped like `content.nc`.
 */
function historyBody(rows: readonly unknown[]): Record<string, unknown> {
  return { content: { nc: rows } };
}

describe('PayBox wallet pagination — duplicate-row regression (T-PBQ-DUP)', () => {
  it('T-PBQ-DUP-1 drops a re-served page instead of emitting every row twice', () => {
    // Live behaviour: page 1 is requested with ts=<oldest of page 0> and
    // the server answers with page 0 verbatim. Those rows were already
    // emitted, so the page must contribute nothing and stop pagination.
    const page = txnsExtractPage({
      body: historyBody([...PAGE_ROWS]),
      cursor: { ts: OLDEST_TS, page: 1 },
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBe(false);
  });

  it('T-PBQ-DUP-2 keeps rows the cursor has not covered yet', () => {
    // Cursor-honouring server: page 1 carries only rows strictly older
    // than the cursor, so nothing is dropped and pagination continues.
    const older = [
      { _id: 'q-4', ts: '2026-05-11T07:00:29.037Z', amt: 7, type: 'incomingTransaction' },
      { _id: 'q-5', ts: '2026-05-10T07:00:29.037Z', amt: 8, type: 'incomingTransaction' },
    ];
    const page = txnsExtractPage({
      body: historyBody(older),
      cursor: { ts: OLDEST_TS, page: 1 },
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toEqual({ ts: '2026-05-10T07:00:29.037Z', page: 2 });
  });

  it('T-PBQ-DUP-3 drops only the boundary row when the cursor is inclusive', () => {
    const inclusive = [PAGE_ROWS[2], { _id: 'q-6', ts: '2026-05-09T00:00:00.000Z', amt: 9 }];
    const page = txnsExtractPage({
      body: historyBody(inclusive),
      cursor: { ts: OLDEST_TS, page: 1 },
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.items).toHaveLength(1);
  });

  it('T-PBQ-DUP-4 never filters the first page (its cursor is the `null` sentinel)', () => {
    const page = txnsExtractPage({
      body: historyBody([...PAGE_ROWS]),
      cursor: false,
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.items).toHaveLength(PAGE_ROWS.length);
  });

  it('T-PBQ-DUP-5 keeps rows whose ts cannot be parsed (fail-open, never lose data)', () => {
    const unparseable = [{ _id: 'q-7', ts: 'not-a-date', amt: 3 }];
    const page = txnsExtractPage({
      body: historyBody(unparseable),
      cursor: { ts: OLDEST_TS, page: 1 },
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.items).toHaveLength(1);
  });

  it('T-PBQ-DUP-6 a re-serving server yields each transaction exactly once end-to-end', async () => {
    // Full phase walk against the observed server behaviour: every
    // /getUserHistory call answers with the same page.
    const servedOnce = historyBody([...PAGE_ROWS]);
    const servedTwice = historyBody([...PAGE_ROWS]);
    const servedThrice = historyBody([...PAGE_ROWS]);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed(servedOnce), succeed(servedTwice), succeed(servedThrice)],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);

    const scraped = await phase(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    const { txns } = scraped.value.scrape.value.accounts[0];
    const ids = txns.map((t): string => String(t.identifier ?? ''));
    expect(txns).toHaveLength(PAGE_ROWS.length);
    expect(new Set(ids).size).toBe(PAGE_ROWS.length);
  });
});

describe('PayBox wallet rows — blank description/memo regression (T-PBQ-DESC)', () => {
  it('T-PBQ-DESC-1 falls back to `text` when `merchantName` is present but blank', () => {
    const mapped = mapWalletTxn({
      _id: 'd-1',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      merchantName: '',
      text: 'העברה מדנה',
    });
    expect(mapped.description).toBe('העברה מדנה');
  });

  it('T-PBQ-DESC-2 treats a whitespace-only `merchantName` as absent', () => {
    const mapped = mapWalletTxn({
      _id: 'd-2',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      merchantName: '   ',
      text: 'קפה',
    });
    expect(mapped.description).toBe('קפה');
  });

  it('T-PBQ-DESC-3 still prefers a populated `merchantName`', () => {
    const mapped = mapWalletTxn({
      _id: 'd-3',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      merchantName: 'סופר',
      text: 'ignored',
    });
    expect(mapped.description).toBe('סופר');
  });

  it('T-PBQ-DESC-4 falls back to `userComment` when `comment` is blank', () => {
    const mapped = mapWalletTxn({
      _id: 'd-4',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      comment: '',
      userComment: 'החזר על ארוחה',
    });
    expect(mapped.memo).toBe('החזר על ארוחה');
  });

  it('T-PBQ-DESC-5 recovers a description from any canonical alias the row carries', () => {
    // PayBox rows for peer transfers carry no merchantName/text; the row
    // still names the counterparty under a canonical description alias,
    // which the shared BFS alias search resolves.
    const mapped = mapWalletTxn({
      _id: 'd-5',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      businessName: 'מכולת השכונה',
    });
    expect(mapped.description).toBe('מכולת השכונה');
  });

  it('T-PBQ-DESC-6 leaves description empty rather than inventing one', () => {
    const mapped = mapWalletTxn({ _id: 'd-6', ts: '2026-05-14T07:00:29.037Z', amt: 12 });
    expect(mapped.description).toBe('');
    expect(mapped.memo).toBe('');
  });
});
