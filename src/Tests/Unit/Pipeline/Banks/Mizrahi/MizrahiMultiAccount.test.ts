/**
 * Mizrahi multi-account contract — the real scrape driver against a
 * simulated two-account session (plan D17).
 *
 * <p>`get428Index` serves only the session's CURRENT account, and the shape
 * switches it with `SkyBL/changeAccount` in the balance step. These tests pin
 * the order that makes this correct — every account's `changeAccount` lands
 * before its own `get428Index` — and that a session which fails to switch
 * fails the scrape instead of filing one account's movements under another,
 * by day and at night (when the bank sends no balance and an ownerless,
 * empty movements page). The second account holds 51 movements, so its
 * `get428Index` walk takes two 50-row pages, the later one echoing the
 * server's `actionGUID` and omitting the owner, like the captured page. A
 * start older than the movements earns each account a backfill round whose
 * range ends before today, so it comes back unnamed, like the live reply
 * (real login #14); it must run before the next account's switch. Like the
 * live server, a reply holds only the requested range's movements, numbered
 * within that reply (`RowNumber` / `TotalRows`), so the round re-serves the
 * oldest day's movements at new positions; each must still be filed exactly
 * once (the duplicate the real-bank gate caught). A first
 * page reaching today opens with the balance line, which maps like a
 * movement; the coverage audit must not count it as one (real login #15).
 *
 * <p>The live test account holds a single account, so the second account
 * here is synthetic (fake numbers), shaped like the captured replies.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { MIZRAHI_API } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeHelpers.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeServedBus, type MizrahiScrapeRun, scrapeOver } from './MizrahiBusFactory.js';

/** Synthetic accounts, in logon `Accounts[]` order (fake values). */
const ACCOUNTS = [
  { SnifAndNumber400: '111-111111', YitraAdkanit: 4321.5 },
  { SnifAndNumber400: '222-222222', YitraAdkanit: -20.5 },
] as const;

/** Rows per get428Index page (the SPA's `maxRow`). */
const PAGE_SIZE = 50;
/** Scrape window: a covered start (no backfill ask) and a pinned end. The
 *  clock is frozen at END, so the 365-day floor never rises past START. */
const START = new Date('2026-02-28T22:00:00.000Z');
const END = new Date('2026-03-15T10:00:00.000Z');
/** END's bank day as `inToDate` — the only range the bank names an owner for. */
const TODAY = '15/03/2026';
/** A start a month before the oldest movement, so the audit asks a backfill. */
const EARLY_START = new Date('2026-01-31T22:00:00.000Z');
/**
 * The section-label row every page carries, keyed like the captured row
 * (real login #15): no date, no amount, the WK reference and number keys
 * present but null — so the hunter still scores the table as transactions.
 */
const LABEL_ROW = {
  RecTypeSpecified: false,
  IsTodayTransaction: false,
  MC02AsmahtaMekoritEZ: null,
  MC02TnuaEZ: 'xx',
  MC02TnuaTeurEZ: 'FAKE LABEL',
  TaarichEreh: null,
  Teur: null,
  TransactionNumber: null,
};

/**
 * The balance line a page whose range reaches today opens with, shaped like
 * the captured row (real login #15): dated today, the balance as its amount,
 * a description — readable by the canonical mapper, yet not a movement.
 * @param account - Owning account position.
 * @returns Raw get428Index row.
 */
function balanceLineOf(account: number): object {
  const amount = { MC02SchumEZ: ACCOUNTS[account].YitraAdkanit, MC02TnuaEZ: '04' };
  const text = { MC02TnuaTeurEZ: 'FAKE BALANCE LINE', IsTodayTransaction: false };
  return { RecTypeSpecified: false, MC02PeulaTaaEZ: '2026-03-15T00:00:00', ...amount, ...text };
}

/**
 * One synthetic posted movement, shaped like the captured row (fake values).
 * Movement 0 falls on the start day, so the window audit sees it covered.
 * @param account - Owning account position.
 * @param n - Movement number within the account.
 * @returns Raw get428Index row.
 */
function movement(account: number, n: number): object {
  const day = `2026-03-${String(1 + (n % 14)).padStart(2, '0')}T00:00:00`;
  const fake = { MC02TnuaTeurEZ: `FAKE ${String(account)}-${String(n)}` };
  const amounts = { MC02SchumEZ: -(n + 1), MC02AsmahtaMekoritEZ: `${String(account)}${String(n)}` };
  const dates = { MC02PeulaTaaEZ: day, MC02ErehTaaEZ: day };
  return {
    RecTypeSpecified: true,
    RecType: 1,
    IsTodayTransaction: false,
    ...dates,
    ...amounts,
    ...fake,
  };
}

/** Every account's movements, by logon position. */
const MOVEMENTS: readonly (readonly object[])[] = [
  [movement(0, 0)],
  Array.from({ length: PAGE_SIZE + 1 }, (_, n): object => movement(1, n)),
];

/** One recorded apiPost dispatch — the path under the API origin. */
interface ICall {
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/**
 * How the simulated `changeAccount` behaves: it moves the session, or leaves
 * it in place while naming either the account it stayed on or the one asked
 * for, or moves it while naming no account.
 */
type SwitchMode = 'moves' | 'staysNamingCurrent' | 'staysNamingRequested' | 'movesNamingNone';

/** Simulated server-side session. */
interface ISession {
  current: number;
  readonly mode: SwitchMode;
  readonly isNight: boolean;
  readonly calls: ICall[];
}

/** Server reply for one path. */
type Route = (session: ISession, body: Readonly<Record<string, unknown>>) => unknown;

/**
 * `SkyBL/logon` — the account list.
 * @returns Logon reply.
 */
function logonReply(): unknown {
  return { body: { user: { Accounts: ACCOUNTS, CurrentAccountIndex: 0 } } };
}

/**
 * `SkyBL/changeAccount` — moves the session per its {@link SwitchMode} and
 * names an account; at night the balance is `null`.
 * @param session - Simulated session.
 * @param body - Request body.
 * @returns changeAccount reply.
 */
function switchReply(session: ISession, body: Readonly<Record<string, unknown>>): unknown {
  const index = body.selectedAccountIndex as number;
  if (session.mode.startsWith('moves')) session.current = index;
  const named = session.mode === 'staysNamingRequested' ? index : session.current;
  const account = ACCOUNTS[named];
  const balance = session.isNight ? null : account.YitraAdkanit;
  if (session.mode === 'movesNamingNone') return { body: { YitraAdkanit: balance } };
  return { body: { ...account, YitraAdkanit: balance } };
}

/**
 * A `DD/MM/YYYY` wire day as a sortable `YYYY-MM-DD` key.
 * @param wireDay - `inFromDate` / `inToDate` value.
 * @returns Sortable day key.
 */
function dayKeyOf(wireDay: unknown): string {
  const [day, month, year] = String(wireDay).split('/');
  return `${year}-${month}-${day}`;
}

/**
 * Whether a movement's day falls inside a requested range.
 * @param row - Simulated movement.
 * @param body - Request body carrying `inFromDate` / `inToDate`.
 * @returns True when the movement is in range.
 */
function isInRange(row: object, body: Readonly<Record<string, unknown>>): boolean {
  const day = (row as { readonly MC02PeulaTaaEZ: string }).MC02PeulaTaaEZ.slice(0, 10);
  return day >= dayKeyOf(body.inFromDate) && day <= dayKeyOf(body.inToDate);
}

/**
 * The current account's movements in the requested range, numbered within
 * this reply like the live server (`RowNumber` from 1, `TotalRows` the
 * reply's size).
 * @param session - Simulated session.
 * @param body - Request body.
 * @returns The reply's movements, in order.
 */
function servedMovements(session: ISession, body: Readonly<Record<string, unknown>>): object[] {
  const inRange = MOVEMENTS[session.current].filter((row): boolean => isInRange(row, body));
  const total = String(inRange.length);
  return inRange.map((row, i): object => ({ ...row, RowNumber: String(i + 1), TotalRows: total }));
}

/** One page of a reply's movements, and whether the reply holds more. */
interface IServedPage {
  readonly movements: readonly object[];
  readonly isHasMoreRows: boolean;
}

/**
 * The page of the reply's movements starting at a row index.
 * @param session - Simulated session.
 * @param body - Request body.
 * @param startRowIndex - The page's first movement index.
 * @returns The page's movements and whether more remain.
 */
function servedPage(
  session: ISession,
  body: Readonly<Record<string, unknown>>,
  startRowIndex: number,
): IServedPage {
  const served = servedMovements(session, body);
  const movements = served.slice(startRowIndex, startRowIndex + PAGE_SIZE);
  return { movements, isHasMoreRows: startRowIndex + PAGE_SIZE < served.length };
}

/**
 * One page's rows: the section label — after the balance line on a named
 * first page — then the page's movements.
 * @param session - Simulated session.
 * @param movements - The page's movements.
 * @param isNamed - Whether the page is the named first page.
 * @returns Raw get428Index rows.
 */
function pageRowsOf(session: ISession, movements: readonly object[], isNamed: boolean): object[] {
  const head = isNamed ? [balanceLineOf(session.current), LABEL_ROW] : [LABEL_ROW];
  return [...head, ...movements];
}

/**
 * `SkyOSH/get428Index` — one 50-row page of the current account's movements
 * after a section label. Like the live bank (real logins #14 and #15), only a
 * first page whose range reaches today names the owner and opens with the
 * balance line; later pages and backfill rounds come back with
 * `fields: null` and no balance line; at night no `fields` and no rows.
 * @param session - Simulated session.
 * @param body - Request body.
 * @returns get428Index reply.
 */
function pageReply(session: ISession, body: Readonly<Record<string, unknown>>): unknown {
  if (session.isNight) return { body: { table: { rows: [] } } };
  const { startRowIndex } = body.table as { readonly startRowIndex: number };
  const isNamed = startRowIndex === 0 && body.inToDate === TODAY;
  const page = servedPage(session, body, startRowIndex);
  const rows = pageRowsOf(session, page.movements, isNamed);
  const fields = isNamed ? { AccountNumber: ACCOUNTS[session.current].SnifAndNumber400 } : null;
  const actionGUID = `guid-${String(session.current)}`;
  return { body: { fields, table: { rows, actionGUID, isHasMoreRows: page.isHasMoreRows } } };
}

const ROUTES: ReadonlyMap<string, Route> = new Map<string, Route>([
  ['SkyBL/logon', logonReply],
  ['SkyBL/changeAccount', switchReply],
  ['SkyOSH/get428Index', pageReply],
]);

/**
 * Serve one dispatch from the simulated session.
 * @param session - Simulated session.
 * @param url - Dispatched URL.
 * @param body - Dispatched body.
 * @returns Reply procedure.
 */
function serve(session: ISession, url: string, body: unknown): Procedure<unknown> {
  const path = url.replace(`${MIZRAHI_API}/`, '');
  const route = ROUTES.get(path);
  if (route === undefined) return fail(ScraperErrorTypes.Generic, `unexpected url=${url}`);
  const record = (body ?? {}) as Readonly<Record<string, unknown>>;
  session.calls.push({ path, body: record });
  const reply = route(session, record);
  return succeed(reply);
}

/**
 * Run the real driver against a fresh simulated session.
 * @param mode - How changeAccount behaves.
 * @param isNight - Whether the bank answers with its night replies.
 * @param startDate - Requested scrape start (default: covered, no backfill).
 * @returns The session (calls recorded) and the scrape promise.
 */
function runScrape(
  mode: SwitchMode,
  isNight: boolean,
  startDate: Date = START,
): { session: ISession; run: MizrahiScrapeRun } {
  const session: ISession = { current: 0, mode, isNight, calls: [] };
  const bus = makeServedBus((url, body): Procedure<unknown> => serve(session, url, body));
  const run = scrapeOver(bus, { start: startDate, end: END });
  return { session, run };
}

/**
 * Label one recorded call: the switch target, or whether a get428Index
 * range reaches today (first walk) or ends earlier (backfill round).
 * @param call - Recorded dispatch.
 * @returns Call label.
 */
function labelOf(call: ICall): string {
  if (call.path === 'SkyBL/changeAccount')
    return `switch ${String(call.body.selectedAccountIndex)}`;
  if (call.path !== 'SkyOSH/get428Index') return call.path;
  return call.body.inToDate === TODAY ? 'walk' : 'backfill';
}

/**
 * The session's call labels with consecutive repeats collapsed.
 * @param session - Simulated session.
 * @returns Collapsed call labels.
 */
function callStages(session: ISession): readonly string[] {
  const labels = session.calls.map(labelOf);
  return labels.filter((label, i): boolean => label !== labels[i - 1]);
}

/**
 * Descriptions sorted, so two lists compare as multisets.
 * @param descriptions - Descriptions in any order.
 * @returns The same descriptions, sorted.
 */
function sortedDescriptions(descriptions: readonly string[]): string[] {
  return [...descriptions].sort((a, b): number => a.localeCompare(b));
}

/**
 * Each account's movement descriptions — what a scrape must file, each once.
 * @returns Sorted descriptions per account, in account order.
 */
function movementDescriptions(): string[][] {
  return MOVEMENTS.map((rows): string[] => {
    const texts = rows.map((row): string => (row as { MC02TnuaTeurEZ: string }).MC02TnuaTeurEZ);
    return sortedDescriptions(texts);
  });
}

describe('Mizrahi multi-account scrape (changeAccount)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: END });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('switches to each account before reading its movements', async () => {
    const { session, run } = runScrape('moves', false);
    const result = await run;
    assertOk(result);
    const paths = session.calls.map((call): string => call.path);
    const switched = session.calls.filter((call): boolean => call.path === 'SkyBL/changeAccount');
    const indexes = switched.map((call): unknown => call.body.selectedAccountIndex);
    expect(paths).toEqual([
      'SkyBL/logon',
      'SkyBL/changeAccount',
      'SkyOSH/get428Index',
      'SkyBL/changeAccount',
      'SkyOSH/get428Index',
      'SkyOSH/get428Index',
    ]);
    expect(indexes).toEqual([0, 1]);
  });

  it('walks every page, echoing the actionGUID of the page before', async () => {
    const { session, run } = runScrape('moves', false);
    assertOk(await run);
    const pages = session.calls.filter((call): boolean => call.path === 'SkyOSH/get428Index');
    const positions = pages.map((call): unknown => {
      const { startRowIndex, actionGuid } = call.body.table as Record<string, unknown>;
      return { startRowIndex, actionGuid };
    });
    expect(positions).toEqual([
      { startRowIndex: 0, actionGuid: '' },
      { startRowIndex: 0, actionGuid: '' },
      { startRowIndex: 50, actionGuid: 'guid-1' },
    ]);
  });

  it("files each account's own mapped movements under it", async () => {
    const { run } = runScrape('moves', false);
    const result = await run;
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const filed = scrape.value.accounts.map((acct, index): object => {
      const isOwn = acct.txns.every((txn): boolean =>
        txn.description.startsWith(`FAKE ${String(index)}-`),
      );
      return { count: acct.txns.length, isOwn };
    });
    expect(filed).toEqual([
      { count: 1, isOwn: true },
      { count: PAGE_SIZE + 1, isOwn: true },
    ]);
  });

  it('publishes every account with its own balance', async () => {
    const { run } = runScrape('moves', false);
    const result = await run;
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const published = scrape.value.accounts.map((acct): object => ({
      accountNumber: acct.accountNumber,
      balance: acct.balance,
    }));
    expect(published).toEqual([
      { accountNumber: '111-111111', balance: 4321.5 },
      { accountNumber: '222-222222', balance: -20.5 },
    ]);
  });

  it("finishes each account's unnamed backfill rounds before the next switch", async () => {
    const { session, run } = runScrape('moves', false, EARLY_START);
    const result = await run;
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const counts = scrape.value.accounts.map((acct): number => acct.txns.length);
    expect(counts).toEqual([1, PAGE_SIZE + 1]);
    const filed = scrape.value.accounts.map((acct): string[] => {
      const descriptions = acct.txns.map((txn): string => txn.description);
      return sortedDescriptions(descriptions);
    });
    const movements = movementDescriptions();
    expect(filed).toEqual(movements);
    const stages = callStages(session);
    expect(stages).toEqual([
      'SkyBL/logon',
      'switch 0',
      'walk',
      'backfill',
      'switch 1',
      'walk',
      'backfill',
    ]);
  });

  it('does not count the balance line as a movement the shape left unread', async () => {
    // The balance line maps like a movement (dated today, the balance as its
    // amount), so without the shape's declared auditIsTxnRow the coverage
    // audit reads it as loss and downgrades a covered window (login #15).
    const { run } = runScrape('moves', false);
    const result = await run;
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const statuses = scrape.value.accounts.map((acct): unknown => acct.windowCoverage?.status);
    expect(statuses).toEqual(['covered', 'covered']);
  });

  it.each([
    { mode: 'staysNamingCurrent', isNight: false, when: 'names the account the session stayed on' },
    { mode: 'staysNamingRequested', isNight: false, when: 'stays put but names the requested one' },
    { mode: 'movesNamingNone', isNight: false, when: 'names no account' },
    { mode: 'staysNamingCurrent', isNight: true, when: 'names another account at night' },
  ] as const)('fails when the switch reply $when', async ({ mode, isNight }) => {
    const { run } = runScrape(mode, isNight);
    await expect(run).rejects.toThrow(ScraperError);
  });

  it('publishes every account without a balance at night', async () => {
    const { run } = runScrape('moves', true);
    const result = await run;
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const published = scrape.value.accounts.map((acct): object => ({
      accountNumber: acct.accountNumber,
      balance: acct.balance,
    }));
    expect(published).toEqual([
      { accountNumber: '111-111111', balance: undefined },
      { accountNumber: '222-222222', balance: undefined },
    ]);
  });
});
