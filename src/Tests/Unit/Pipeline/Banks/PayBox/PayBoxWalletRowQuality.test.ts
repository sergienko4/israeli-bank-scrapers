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
      cursor: { ts: OLDEST_TS, page: 1, seenIds: ['q-3'] },
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
    // The new boundary row is remembered by identity so the next page can
    // tell a re-serve from a distinct transaction sharing that timestamp.
    expect(page.nextCursor).toEqual({
      ts: '2026-05-10T07:00:29.037Z',
      page: 2,
      seenIds: ['q-5'],
    });
  });

  it('T-PBQ-DUP-3 drops only the boundary row when the cursor is inclusive', () => {
    const inclusive = [PAGE_ROWS[2], { _id: 'q-6', ts: '2026-05-09T00:00:00.000Z', amt: 9 }];
    const page = txnsExtractPage({
      body: historyBody(inclusive),
      cursor: { ts: OLDEST_TS, page: 1, seenIds: ['q-3'] },
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

  it('T-PBQ-DUP-7 keeps a DISTINCT row that merely shares the boundary ts', () => {
    // Two transactions can legitimately carry the same timestamp. Only
    // the identities the previous page already emitted may be dropped —
    // a timestamp match alone is not evidence of a duplicate.
    const shared = [{ _id: 'q-9', ts: OLDEST_TS, amt: 99, type: 'incomingTransaction' }];
    const page = txnsExtractPage({
      body: historyBody(shared),
      cursor: { ts: OLDEST_TS, page: 1, seenIds: ['q-3'] },
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.items).toHaveLength(1);
  });

  it('T-PBQ-DUP-8 a boundary-sharing transaction survives the full walk', async () => {
    const shared = [
      { _id: 'q-8', ts: OLDEST_TS, amt: 99, type: 'incomingTransaction' },
      { _id: 'q-9', ts: '2026-05-11T07:00:29.037Z', amt: 5, type: 'incomingTransaction' },
    ];
    const firstPage = historyBody([...PAGE_ROWS]);
    const secondPage = historyBody(shared);
    const emptyPage = historyBody([]);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed(firstPage), succeed(secondPage), succeed(emptyPage)],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);

    const scraped = await phase(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    const { txns } = scraped.value.scrape.value.accounts[0];
    expect(txns).toHaveLength(PAGE_ROWS.length + shared.length);
  });

  it('T-PBQ-DUP-9 still de-duplicates when the oldest row carries a malformed ts', async () => {
    // A malformed final ts must not become the cursor: it would make the
    // boundary unparseable and silently disable duplicate filtering.
    const withBadTail = [...PAGE_ROWS, { _id: 'q-bad', ts: 'not-a-date', amt: 1 }];
    const servedOnce = historyBody(withBadTail);
    const servedTwice = historyBody(withBadTail);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed(servedOnce), succeed(servedTwice)],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);

    const scraped = await phase(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    const { txns } = scraped.value.scrape.value.accounts[0];
    const ids = txns.map((t): string => String(t.identifier ?? ''));
    const unique = new Set(ids);
    expect(txns).toHaveLength(withBadTail.length);
    expect(unique.size).toBe(withBadTail.length);
  });

  it('T-PBQ-DUP-10 recognises a re-serve that respells the boundary ts', async () => {
    // Two rows share the oldest instant but spell it differently — `Z`
    // versus a zero offset. The cursor can only carry one spelling, so
    // deciding which rows are ambiguous by comparing timestamp TEXT
    // remembers just one of them; the other returns on the re-served
    // page sitting exactly on the boundary and is emitted twice.
    const sameInstant = [
      { _id: 'q-a', ts: '2026-05-12T07:00:29.037Z', amt: 12, type: 'incomingTransaction' },
      { _id: 'q-b', ts: '2026-05-12T07:00:29.037+00:00', amt: 34, type: 'incomingTransaction' },
    ];
    const servedOnce = historyBody(sameInstant);
    const servedTwice = historyBody(sameInstant);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed(servedOnce), succeed(servedTwice)],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);

    const scraped = await phase(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    const { txns } = scraped.value.scrape.value.accounts[0];
    const ids = txns.map((t): string => String(t.identifier ?? ''));
    const unique = new Set(ids);
    expect(txns).toHaveLength(sameInstant.length);
    expect(unique.size).toBe(sameInstant.length);
  });

  it('T-PBQ-DUP-11 remembers a malformed-ts row the page dropped by identity', async () => {
    // A row with an unparseable ts is kept fail-open, so ONLY its identity
    // can recognise it a second time. When such a row is dropped by
    // identity it never reaches the emitted rows, so deriving the next
    // cursor's memory from those alone forgets it — and the very next
    // re-serve sails through the fail-open rule and emits it twice.
    const badTs = { _id: 'q-x', ts: 'not-a-date', amt: 12, type: 'incomingTransaction' };
    const newest = {
      _id: 'q-a',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 34,
      type: 'incomingTransaction',
    };
    const older = {
      _id: 'q-z',
      ts: '2026-05-13T07:00:29.037Z',
      amt: 56,
      type: 'incomingTransaction',
    };
    const page0 = historyBody([newest, badTs]);
    const page1 = historyBody([newest, badTs, older]);
    const reserve = historyBody([badTs, older]);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed(page0), succeed(page1), succeed(reserve)],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);

    const scraped = await phase(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    const { txns } = scraped.value.scrape.value.accounts[0];
    const ids = txns.map((t): string => String(t.identifier ?? ''));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });

  it('T-PBQ-DUP-12 takes the boundary from the oldest row, not the last one', () => {
    // Nothing guarantees the server sorts a page. Reading the boundary
    // positionally trusts an ordering the payload never promised: with
    // the true oldest row in the middle, the cursor lands too new and a
    // re-serve replays every row below it.
    const unsorted = [
      { _id: 'u-1', ts: '2026-05-14T00:00:00.000Z', amt: 1 },
      { _id: 'u-2', ts: '2026-05-12T00:00:00.000Z', amt: 2 },
      { _id: 'u-3', ts: '2026-05-13T00:00:00.000Z', amt: 3 },
    ];
    const page = txnsExtractPage({
      body: historyBody(unsorted),
      cursor: { ts: 'null', page: 0 },
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.nextCursor).toMatchObject({ ts: '2026-05-12T00:00:00.000Z' });
  });

  it('T-PBQ-DUP-13 refuses a non-ISO ts as the pagination boundary', () => {
    // `Date.parse('1')` yields a valid instant in 2001. Accepting it as
    // the boundary would make every genuine 2026 row look NEWER than the
    // cursor, so the next page would discard real transactions.
    const withJunk = [
      { _id: 'j-1', ts: '2026-05-14T00:00:00.000Z', amt: 1 },
      { _id: 'j-2', ts: '1', amt: 2 },
    ];
    const page = txnsExtractPage({
      body: historyBody(withJunk),
      cursor: { ts: 'null', page: 0 },
      acct: WALLET_ACCT,
      ctx: BARE_CTX,
    });
    expect(page.nextCursor).toMatchObject({ ts: '2026-05-14T00:00:00.000Z' });
  });

  it('T-PBQ-DUP-14 keeps an id-less boundary row but not its re-serve', async () => {
    // A row carrying no identity cannot be told apart from a re-serve by
    // id. Dropping it loses a real transaction, so it must survive when
    // it is new — while a verbatim re-serve must still not emit it twice.
    const idless = { ts: '2026-05-12T00:00:00.000Z', amt: 7, merchantName: 'קיוסק' };
    const page0 = historyBody([
      { _id: 'k-1', ts: '2026-05-14T00:00:00.000Z', amt: 1 },
      { _id: 'k-2', ts: '2026-05-12T00:00:00.000Z', amt: 2 },
    ]);
    const page1 = historyBody([idless, { _id: 'k-3', ts: '2026-05-11T00:00:00.000Z', amt: 3 }]);
    const reserve = historyBody([idless, { _id: 'k-3', ts: '2026-05-11T00:00:00.000Z', amt: 3 }]);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed(page0), succeed(page1), succeed(reserve)],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);

    const scraped = await phase(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    const { txns } = scraped.value.scrape.value.accounts[0];
    expect(txns).toHaveLength(4);
  });

  it('T-PBQ-DUP-16 fingerprints an id-less row through nested key order', async () => {
    // The fingerprint is only an identity if it survives re-serialisation.
    // A nested object whose keys come back in a different order is the
    // same transaction, so it must fingerprint the same and be dropped.
    const nested = { merchantName: 'קיוסק', businessName: 'דוכן' };
    const reordered = { businessName: 'דוכן', merchantName: 'קיוסק' };
    const idless = { ts: '2026-05-11T00:00:00.000Z', amt: 7, transfer: nested };
    const shuffled = { ts: '2026-05-11T00:00:00.000Z', amt: 7, transfer: reordered };
    const page0 = historyBody([
      { _id: 'n-1', ts: '2026-05-14T00:00:00.000Z', amt: 1 },
      { _id: 'n-2', ts: '2026-05-12T00:00:00.000Z', amt: 2 },
    ]);
    const page1 = historyBody([idless, { _id: 'n-3', ts: '2026-05-11T00:00:00.000Z', amt: 3 }]);
    const reserve = historyBody([shuffled, { _id: 'n-3', ts: '2026-05-11T00:00:00.000Z', amt: 3 }]);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed(page0), succeed(page1), succeed(reserve)],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);

    const scraped = await phase(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    const { txns } = scraped.value.scrape.value.accounts[0];
    expect(txns).toHaveLength(4);
  });

  it('T-PBQ-DUP-15 survives a row whose `type` is not a string', () => {
    // `servedRows` casts parsed JSON without validating it, so a row can
    // reach the mapper with any runtime type. A `type` that is not a
    // string must not throw — one malformed row cannot fail the scrape.
    const badType = [{ _id: 'b-1', ts: '2026-05-14T00:00:00.000Z', amt: 5, type: 42 }];
    /**
     * Run the extractor over the malformed row.
     * @returns Extraction outcome, discarded — only throwing matters here.
     */
    const extract = (): unknown =>
      txnsExtractPage({
        body: historyBody(badType),
        cursor: { ts: 'null', page: 0 },
        acct: WALLET_ACCT,
        ctx: BARE_CTX,
      });
    expect(extract).not.toThrow();
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

  it('T-PBQ-DESC-7 recovers a description nested under a sub-object', () => {
    // Peer transfers name their counterparty inside a nested block, so
    // the alias search must still see nested records — stripping every
    // non-string value to hide blanks would make it blind to them.
    const mapped = mapWalletTxn({
      _id: 'd-7',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      merchantName: '',
      transfer: { businessName: 'רות לוי' },
    });
    expect(mapped.description).toBe('רות לוי');
  });

  it('T-PBQ-DESC-8 skips a blank nested alias and keeps searching', () => {
    // `withoutBlanks` only strips blanks at the top level, so a blank
    // alias nested one level down still wins the search and shadows a
    // populated peer. Taking the first NON-BLANK hit is what makes the
    // blank-means-absent rule hold at every depth, not just the root.
    const mapped = mapWalletTxn({
      _id: 'd-8',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      merchantName: '',
      transfer: { merchantName: '   ', businessName: 'אבי כהן' },
    });
    expect(mapped.description).toBe('אבי כהן');
  });
});
