/**
 * Mizrahi hard-model scrape shape — unit coverage for the accounts,
 * balance and transactions extractors plus the shape wiring.
 *
 * <p>Extractors run against the committed, PII-redacted Mode B responses
 * (`fixtures/banks/mizrahi/responses/*.json`), so the field paths are pinned
 * to the captured wire format; edge cases use synthetic bodies (fake values).
 */

import { jest } from '@jest/globals';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { MIZRAHI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShape.js';
import {
  balanceExtract,
  balanceIsAbsent,
  balanceUrl,
  balanceVars,
} from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeBalance.js';
import {
  accountNumberOf,
  customerUrl,
  customerVars,
  extractAccounts,
  type IMizrahiAcct,
} from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeHelpers.js';
import {
  type IMizrahiCursor,
  txnsExtractPage,
  txnsUrl,
  txnsVars,
} from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeTxns.js';
import type { ApiRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { bankMomentOfInstant } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import { autoMapTransaction } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
  IExtractPageArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { type ITransaction, TransactionStatuses } from '../../../../../Transactions.js';
import { AMBIENT_ZONE_CASES, underZone } from '../../../../Helpers/AmbientZone.js';
import { loadMizrahiResponse } from './MizrahiBusFactory.js';

const API = 'https://mto.mizrahi-tefahot.co.il/Online/api';

/** Raw logon account fields the assertions compare against. */
interface IFixtureAccount {
  readonly SnifAndNumber400: string;
  readonly YitraAdkanit: number;
}

/** Raw get428Index movement fields the mapping assertions compare against. */
interface IFixtureRow {
  readonly MC02PeulaTaaEZ: string;
  readonly MC02SchumEZ: number;
  readonly MC02TnuaTeurEZ: string;
}

/** Extract-page args for the Mizrahi shape. */
type PageArgs = IExtractPageArgs<IMizrahiAcct, IMizrahiCursor>;

/**
 * Bundle a raw body into the extract-accounts args.
 * @param body - Raw logon response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Wrap synthetic accounts in the logon envelope.
 * @param accounts - Raw `Accounts[]` entries (fake values).
 * @returns Raw logon response body.
 */
function logonBody(accounts: readonly object[]): ApiBody {
  return { body: { user: { Accounts: accounts } } };
}

/**
 * Wrap a synthetic changeAccount reply.
 * @param snif - Reply `SnifAndNumber400`.
 * @param yitra - Reply `YitraAdkanit`.
 * @returns Raw changeAccount response body.
 */
function switchBody(snif: string, yitra: unknown): ApiBody {
  return { body: { SnifAndNumber400: snif, YitraAdkanit: yitra } };
}

/**
 * Wrap a synthetic get428Index page.
 * @param fields - The page's `fields` (`{}` to omit the owner).
 * @param rows - The table rows.
 * @param paging - Extra table keys (`isHasMoreRows`, `actionGUID`).
 * @returns Raw get428Index response body.
 */
function txnsBody(fields: object, rows: readonly object[], paging: object = {}): ApiBody {
  return { body: { fields, table: { rows, ...paging } } };
}

/**
 * Bundle a page body into the extract-page args for {@link ACCT}.
 * @param body - Raw get428Index response body.
 * @param cursor - The page's position (false on the first page).
 * @returns Extract-page args bundle.
 */
function pageArgs(body: ApiBody, cursor: IMizrahiCursor | false): PageArgs {
  return { body, cursor, acct: ACCT, ctx: ctxWith(NOW, NOW) };
}

/**
 * Defer a page extraction so `toThrow` can observe it.
 * @param args - Extract-page args bundle.
 * @returns Thunk running the extractor.
 */
function extractLater(args: PageArgs): () => unknown {
  return (): unknown => txnsExtractPage(args);
}

/**
 * The items a first page with these rows extracts to, for {@link ACCT}.
 * @param fields - The reply's `fields` (owner, or none on a backfill round).
 * @param rows - The table rows.
 * @returns Extracted items.
 */
function extractedItems(fields: object, rows: readonly object[]): readonly object[] {
  const body = txnsBody(fields, rows);
  const args = pageArgs(body, false);
  return txnsExtractPage(args).items;
}

/**
 * The bank-calendar day of a mapped ISO instant.
 * @param iso - Mapped transaction date.
 * @returns `YYYY-MM-DD` in the bank's zone.
 */
function bankDayOf(iso: string): string {
  const instant = new Date(iso);
  return bankMomentOfInstant(instant).format('YYYY-MM-DD');
}

/**
 * Map the fixture page's one movement through the shared auto-mapper.
 * @param extra - Raw keys merged over the captured row.
 * @returns The raw row and its mapped transaction.
 */
function mapFixtureRow(extra: object): { raw: IFixtureRow; txn: ITransaction } {
  const body = loadMizrahiResponse('transactions');
  const page = txnsExtractPage({ ...pageArgs(body, false), acct: FIXTURE_ACCT });
  const raw = { ...page.items[0], ...extra } as unknown as IFixtureRow;
  const txn = autoMapTransaction(raw as unknown as ApiRecord, MIZRAHI_SHAPE.isCardIssuer);
  if (txn === false) throw new TypeError('row was rejected by the mapper');
  return { raw, txn };
}

/**
 * Defer a balance-absence check so `toThrow` can observe it.
 * @param body - Raw changeAccount response body.
 * @param acct - Account the switch asked for.
 * @returns Thunk running the check.
 */
function absentLater(body: ApiBody, acct: IMizrahiAcct): () => unknown {
  return (): unknown => balanceIsAbsent(body, acct);
}

/**
 * Defer an account extraction so `toThrow` can observe it.
 * @param args - Extract-accounts args bundle.
 * @returns Thunk running the extractor.
 */
function accountsLater(args: IExtractAccountsArgs): () => unknown {
  return (): unknown => extractAccounts(args);
}

/**
 * Action context carrying a start date and a pinned window end.
 * @param startDate - Scrape start instant.
 * @param windowEnd - Scrape window end instant.
 * @returns Partial action context cast.
 */
function ctxWith(startDate: Date, windowEnd: Date): IActionContext {
  const bound = some(windowEnd);
  return { options: { startDate }, windowEnd: bound } as unknown as IActionContext;
}

const LOGON = loadMizrahiResponse('logon');
const LOGON_ARGS = accountsArgs(LOGON);
const RAW_ACCT = (LOGON as { body: { user: { Accounts: readonly IFixtureAccount[] } } }).body.user
  .Accounts[0];
const NOW = new Date('2026-03-15T10:00:00.000Z');
const ACCT: IMizrahiAcct = { index: 1, accountNumber: '99-888777' };
const FIXTURE_ACCT: IMizrahiAcct = { index: 0, accountNumber: RAW_ACCT.SnifAndNumber400 };
const OWNER = { AccountNumber: ACCT.accountNumber };
/** A transaction row and a balance-header / section-label row. */
const TXN_ROW = { RecTypeSpecified: true, RecType: 1 } as const;
const LABEL_ROW = { RecTypeSpecified: false } as const;
const PAGE_2: IMizrahiCursor = { startRowIndex: 50, actionGuid: 'guid-1' };
/** The oldest bank day the server serves when "today" is {@link NOW}. */
const FLOOR_DAY = '15/03/2025';
const DAY_MS = 86_400_000;
/** Window edges, in days from {@link NOW}, on both sides of the 365-day floor. */
const GRID_DAYS = [-800, -366, -365, -364, -30, 0, 5] as const;
const WINDOW_GRID = GRID_DAYS.flatMap((start): (readonly [number, number])[] =>
  GRID_DAYS.map((end): readonly [number, number] => [start, end] as const),
);

/**
 * An instant a whole number of days from {@link NOW}.
 * @param days - Offset in days (negative is the past).
 * @returns The shifted instant.
 */
function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

/**
 * A `DD/MM/YYYY` wire day as a sortable `YYYYMMDD` number.
 * @param wire - Day as sent in `inFromDate` / `inToDate`.
 * @returns The same day, comparable with `<`.
 */
function bankDayValue(wire: unknown): number {
  const [day, month, year] = String(wire).split('/').map(Number);
  return year * 10_000 + month * 100 + day;
}

describe('MizrahiShape accounts', () => {
  it('extractAccounts maps the fixture account at its position', () => {
    const accounts = extractAccounts(LOGON_ARGS);
    expect(accounts).toEqual([FIXTURE_ACCT]);
  });

  it('keeps every declared account with its Accounts[] position', () => {
    const body = logonBody([{ SnifAndNumber400: '111-111111' }, { SnifAndNumber400: '222-222' }]);
    const args = accountsArgs(body);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([
      { index: 0, accountNumber: '111-111111' },
      { index: 1, accountNumber: '222-222' },
    ]);
  });

  it('throws when a declared account has no number', () => {
    const body = logonBody([{ SnifAndNumber400: '111-111111' }, { Name: 'fake' }]);
    const args = accountsArgs(body);
    const extract = accountsLater(args);
    expect(extract).toThrow(ScraperError);
  });

  it('tolerates an empty body', () => {
    const args = accountsArgs({});
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf is SnifAndNumber400', () => {
    const display = accountNumberOf(ACCT);
    expect(display).toBe('99-888777');
  });
});

describe('MizrahiShape balance (changeAccount)', () => {
  it('selects the account by its logon position', () => {
    const vars = balanceVars(ACCT);
    expect(vars).toEqual({ selectedAccountIndex: 1 });
  });

  it('reads the fixture reply YitraAdkanit as present', () => {
    const body = loadMizrahiResponse('changeAccount');
    const isAbsent = balanceIsAbsent(body, FIXTURE_ACCT);
    const balance = balanceExtract(body);
    expect(isAbsent).toBe(false);
    expect(balance).toBe(RAW_ACCT.YitraAdkanit);
  });

  it('reports a null YitraAdkanit (night) as absent', () => {
    const body = switchBody(ACCT.accountNumber, null);
    const isAbsent = balanceIsAbsent(body, ACCT);
    expect(isAbsent).toBe(true);
  });

  it('throws when the reply names another account', () => {
    const body = switchBody('11-111111', 4321.5);
    const check = absentLater(body, ACCT);
    expect(check).toThrow(ScraperError);
  });

  it('throws when the reply names no account', () => {
    const body = { body: { YitraAdkanit: 4321.5 } };
    const check = absentLater(body, ACCT);
    expect(check).toThrow(ScraperError);
  });

  it('throws on an empty reply', () => {
    const check = absentLater({}, ACCT);
    expect(check).toThrow(ScraperError);
  });
});

describe('MizrahiShape transactions window', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(AMBIENT_ZONE_CASES)('renders the window as bank days under %s', zone => {
    const start = new Date('2026-02-28T22:30:00.000Z');
    const end = new Date('2026-03-31T21:30:00.000Z');
    const ctx = ctxWith(start, end);
    const vars = underZone(zone, () => txnsVars(ACCT, false, ctx));
    expect(vars).toEqual({
      inToDate: '01/04/2026',
      inFromDate: '01/03/2026',
      inSugTnua: '',
      table: { startRowIndex: 0, maxRow: 50, actionGuid: '', sortExpression: '' },
      isFromSearch: false,
    });
  });

  it.each(AMBIENT_ZONE_CASES)('clamps the start to 365 days before today under %s', zone => {
    const ctx = ctxWith(new Date('2024-01-01T00:00:00.000Z'), NOW);
    const vars = underZone(zone, () => txnsVars(ACCT, false, ctx));
    expect(vars.inFromDate).toBe('15/03/2025');
    expect(vars.inToDate).toBe('15/03/2026');
  });

  it('counts 365 days, not a calendar year, across a leap day', () => {
    const leapNow = new Date('2028-03-01T10:00:00.000Z');
    jest.setSystemTime(leapNow);
    const ctx = ctxWith(new Date('2026-01-01T00:00:00.000Z'), leapNow);
    const vars = txnsVars(ACCT, false, ctx);
    // A calendar year back would be 01/03/2027 — 366 days, which the server refuses.
    expect(vars.inFromDate).toBe('02/03/2027');
    expect(vars.inToDate).toBe('01/03/2028');
  });

  it('never asks below the floor when backfill narrows the window end', () => {
    const narrowedEnd = new Date('2025-06-01T10:00:00.000Z');
    const ctx = ctxWith(new Date('2024-01-01T00:00:00.000Z'), narrowedEnd);
    const vars = txnsVars(ACCT, false, ctx);
    expect(vars.inFromDate).toBe('15/03/2025');
    expect(vars.inToDate).toBe('01/06/2025');
  });

  it('asks for the floor day alone when a backfill bound falls before the floor', () => {
    const preFloorEnd = new Date('2025-03-10T21:59:59.999Z');
    const ctx = ctxWith(new Date('2024-01-01T00:00:00.000Z'), preFloorEnd);
    const vars = txnsVars(ACCT, false, ctx);
    expect(vars.inFromDate).toBe('15/03/2025');
    expect(vars.inToDate).toBe('15/03/2025');
  });

  it('keeps the range ordered when bank midnight passes between backfill rounds', () => {
    const oldFloorDayEnd = new Date('2025-03-15T21:59:59.999Z');
    jest.setSystemTime(new Date('2026-03-16T10:00:00.000Z'));
    const ctx = ctxWith(new Date('2024-01-01T00:00:00.000Z'), oldFloorDayEnd);
    const vars = txnsVars(ACCT, false, ctx);
    expect(vars.inFromDate).toBe('16/03/2025');
    expect(vars.inToDate).toBe('16/03/2025');
  });

  it.each(WINDOW_GRID)(
    'never sends a start after the end or before the floor (start %s, end %s days)',
    (startDays, endDays) => {
      const start = daysFromNow(startDays);
      const end = daysFromNow(endDays);
      const ctx = ctxWith(start, end);
      const vars = txnsVars(ACCT, false, ctx);
      const fromDay = bankDayValue(vars.inFromDate);
      const toDay = bankDayValue(vars.inToDate);
      const floorDay = bankDayValue(FLOOR_DAY);
      expect(fromDay).toBeLessThanOrEqual(toDay);
      expect(fromDay).toBeGreaterThanOrEqual(floorDay);
    },
  );

  it('asks for the end day alone when the start is after the window end', () => {
    const ctx = ctxWith(new Date('2026-04-01T10:00:00.000Z'), NOW);
    const vars = txnsVars(ACCT, false, ctx);
    expect(vars.inFromDate).toBe('15/03/2026');
    expect(vars.inToDate).toBe('15/03/2026');
  });

  it('asks a later page from its row index with the echoed actionGuid', () => {
    const ctx = ctxWith(NOW, NOW);
    const vars = txnsVars(ACCT, PAGE_2, ctx);
    expect(vars.table).toEqual({
      startRowIndex: 50,
      maxRow: 50,
      actionGuid: 'guid-1',
      sortExpression: '',
    });
  });
});

describe('MizrahiShape transactions rows', () => {
  it('keeps only the movement row of the fixture page', () => {
    const body = loadMizrahiResponse('transactions');
    const page = txnsExtractPage({ ...pageArgs(body, false), acct: FIXTURE_ACCT });
    const codes = page.items.map((row): unknown => (row as { MC02TnuaEZ?: unknown }).MC02TnuaEZ);
    expect(codes).toEqual(['01']);
    expect(page.nextCursor).toBe(false);
  });

  it('keeps rows by RecTypeSpecified, whatever their RecType', () => {
    const today = { RecTypeSpecified: true, RecType: 2 };
    const rows = [LABEL_ROW, TXN_ROW, today, { RecType: 1 }];
    const body = txnsBody(OWNER, rows);
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.items).toEqual([TXN_ROW, today]);
  });

  it('throws when the page names another account', () => {
    const body = txnsBody({ AccountNumber: '11-111111' }, [LABEL_ROW, TXN_ROW]);
    const args = pageArgs(body, false);
    const extract = extractLater(args);
    expect(extract).toThrow(ScraperError);
  });

  it('throws when the page names another account even with no rows', () => {
    const body = txnsBody({ AccountNumber: '11-111111' }, []);
    const args = pageArgs(body, false);
    const extract = extractLater(args);
    expect(extract).toThrow(ScraperError);
  });

  it('accepts a first page without fields (a backfill round ending before today)', () => {
    const body: ApiBody = { body: { fields: null, table: { rows: [LABEL_ROW, TXN_ROW] } } };
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.items).toEqual([TXN_ROW]);
  });

  it('throws when a later page names another account', () => {
    const body = txnsBody({ AccountNumber: '11-111111' }, [TXN_ROW]);
    const args = pageArgs(body, PAGE_2);
    const extract = extractLater(args);
    expect(extract).toThrow(ScraperError);
  });

  it('accepts a later page that omits the owner', () => {
    const body = txnsBody({}, [TXN_ROW]);
    const args = pageArgs(body, PAGE_2);
    const page = txnsExtractPage(args);
    expect(page.items).toEqual([TXN_ROW]);
  });

  it('tolerates a body without fields or a table (night)', () => {
    const args = pageArgs({}, false);
    const page = txnsExtractPage(args);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
  });

  it('extracts a movement identically wherever a reply numbers it', () => {
    const inFullReply = { ...TXN_ROW, RowNumber: '2', TotalRows: '2' };
    const inBackfillReply = { ...TXN_ROW, RowNumber: '1', TotalRows: '1' };
    const full = extractedItems(OWNER, [inFullReply]);
    const backfill = extractedItems({}, [inBackfillReply]);
    expect(backfill).toStrictEqual(full);
    expect(full).toStrictEqual([TXN_ROW]);
  });

  it('keeps two movements that differ only by their position', () => {
    const rows = [1, 2].map((n): object => ({ ...TXN_ROW, RowNumber: String(n), TotalRows: '2' }));
    const items = extractedItems(OWNER, rows);
    expect(items).toStrictEqual([TXN_ROW, TXN_ROW]);
  });

  it('extracts a movement the bank left unnumbered (pending)', () => {
    const pending = { ...TXN_ROW, IsTodayTransaction: true };
    const row = { ...pending, RowNumber: null, TotalRows: null };
    const items = extractedItems(OWNER, [row]);
    expect(items).toStrictEqual([pending]);
  });
});

describe('MizrahiShape transactions paging', () => {
  it('continues from row 50 with the actionGUID while more rows remain', () => {
    const more = { isHasMoreRows: true, actionGUID: 'guid-1' };
    const body = txnsBody(OWNER, [TXN_ROW], more);
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.nextCursor).toEqual(PAGE_2);
  });

  it('advances a later page by another 50 rows', () => {
    const more = { isHasMoreRows: true, actionGUID: 'guid-1' };
    const body = txnsBody({}, [TXN_ROW], more);
    const args = pageArgs(body, PAGE_2);
    const page = txnsExtractPage(args);
    expect(page.nextCursor).toEqual({ startRowIndex: 100, actionGuid: 'guid-1' });
  });

  it('stops when the server reports no more rows', () => {
    const body = txnsBody(OWNER, [TXN_ROW], { isHasMoreRows: false, actionGUID: 'guid-1' });
    const args = pageArgs(body, false);
    const page = txnsExtractPage(args);
    expect(page.nextCursor).toBe(false);
  });

  it.each([{}, { actionGUID: '' }])('throws when more rows come without an id (%j)', guid => {
    const body = txnsBody(OWNER, [TXN_ROW], { isHasMoreRows: true, ...guid });
    const args = pageArgs(body, false);
    const extract = extractLater(args);
    expect(extract).toThrow(ScraperError);
  });
});

/** TC-N2 bodies: the container removed, and JSON that is not an object. */
const MALFORMED_BODIES: readonly (readonly [string, unknown])[] = [
  ['an envelope without its container', { body: {} }],
  ['a null envelope', { body: null }],
  ['a number', 42],
  ['a string', 'not-json'],
  ['an array', []],
];

describe('MizrahiShape malformed responses (TC-N2)', () => {
  it.each(MALFORMED_BODIES)('reads %s as no accounts', (_label, raw) => {
    const args = accountsArgs(raw as ApiBody);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it.each(MALFORMED_BODIES)('refuses %s as an unconfirmed switch', (_label, raw) => {
    const body = raw as ApiBody;
    const check = absentLater(body, ACCT);
    const balance = balanceExtract(body);
    expect(check).toThrow(ScraperError);
    expect(balance).toBe(0);
  });

  it.each(MALFORMED_BODIES)('reads %s as an empty last page', (_label, raw) => {
    const args = pageArgs(raw as ApiBody, false);
    const page = txnsExtractPage(args);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
  });
});

describe('MizrahiShape transaction mapping', () => {
  it('maps the captured movement through the shared auto-mapper', () => {
    const { raw, txn } = mapFixtureRow({});
    const day = bankDayOf(txn.date);
    const rawDay = raw.MC02PeulaTaaEZ.slice(0, 10);
    expect(day).toBe(rawDay);
    expect(txn.chargedAmount).toBe(raw.MC02SchumEZ);
    expect(txn.originalAmount).toBe(raw.MC02SchumEZ);
    expect(txn.description).toBe(raw.MC02TnuaTeurEZ);
    expect(txn.status).toBe(TransactionStatuses.Completed);
  });

  it('reports shekels: the null kodMatbea matches no currency alias', () => {
    const { raw, txn } = mapFixtureRow({});
    expect(raw).toHaveProperty('kodMatbea', null);
    expect(txn.originalCurrency).toBe('ILS');
  });

  it('dates a movement without a value date (DateTime.MinValue) by its own date', () => {
    const { txn } = mapFixtureRow({ MC02ErehTaaEZ: '0001-01-01T00:00:00' });
    expect(txn.processedDate).toBe(txn.date);
  });

  it('dates a movement by its value date when the bank sets one', () => {
    const { txn } = mapFixtureRow({ MC02ErehTaaEZ: '2026-10-08T00:00:00' });
    const processedDay = bankDayOf(txn.processedDate);
    expect(processedDay).toBe('2026-10-08');
  });

  it("marks today's movement pending", () => {
    const { txn } = mapFixtureRow({ IsTodayTransaction: true });
    expect(txn.status).toBe(TransactionStatuses.Pending);
  });
});

describe('MizrahiShape wiring', () => {
  it('posts the static logon body to SkyBL/logon', () => {
    const url = customerUrl();
    const vars = customerVars();
    expect(url).toBe(`${API}/SkyBL/logon`);
    expect(vars).toEqual({ appId: 'skyWeb', appVer: '', lang: 'he-il', isPdf: false });
    expect(MIZRAHI_SHAPE.customer.method).toBe('POST');
    expect(MIZRAHI_SHAPE.customer.countDiscovered).toBeUndefined();
  });

  it('switches accounts through SkyBL/changeAccount, failing hard on error', () => {
    const url = balanceUrl();
    expect(url).toBe(`${API}/SkyBL/changeAccount`);
    expect(MIZRAHI_SHAPE.balance.urlTag).toBe(url);
    expect(MIZRAHI_SHAPE.balance.method).toBe('POST');
    expect(MIZRAHI_SHAPE.balance.buildVars).toBe(balanceVars);
    expect(MIZRAHI_SHAPE.balance.skipFetch).toBeUndefined();
    expect(MIZRAHI_SHAPE.balance.fallbackOnFail).toBeUndefined();
  });

  it('posts movements to get428Index', () => {
    const url = txnsUrl();
    expect(url).toBe(`${API}/SkyOSH/get428Index`);
    expect(MIZRAHI_SHAPE.transactions.urlTag).toBe(`${API}/SkyOSH/get428Index`);
    expect(MIZRAHI_SHAPE.transactions.method).toBe('POST');
    expect(MIZRAHI_SHAPE.transactions.windowNarrowing).toBe('windowEnd');
  });
});
