/**
 * Mizrahi backfill at the 365-day floor — the real scrape driver against a
 * simulated session whose clock crosses bank midnight between rounds.
 *
 * <p>The server serves 365 days back from today and answers an older
 * `inFromDate`, or a start after the end, with HTTP 500 (a failed dispatch
 * here). A start older than the floor earns a backfill round bounded by the
 * end of the oldest held day — the floor day. When bank midnight passes
 * before that round, the floor rises past the bound: the round must ask for
 * the new floor day alone, the bound must then stop moving, and the scrape
 * must keep every movement instead of failing.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { MIZRAHI_API } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeHelpers.js';
import { bankMomentOfInstant } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeServedBus, type MizrahiScrapeRun, scrapeOver } from './MizrahiBusFactory.js';

/** The single synthetic account (fake values). */
const ACCOUNT = { SnifAndNumber400: '111-111111', YitraAdkanit: 100 } as const;
/** First walk's clock, and the clock after bank midnight has passed. */
const NOW = new Date('2026-03-15T10:00:00.000Z');
const NEXT_DAY = new Date('2026-03-16T10:00:00.000Z');
/** A requested start older than the floor, so the audit asks a backfill. */
const START = new Date('2024-01-01T00:00:00.000Z');
/** Days of history the simulated server serves. */
const HISTORY_DAYS = 365;
/** Movement days: the floor day under {@link NOW}, and a recent day. */
const MOVEMENT_DAYS = ['2025-03-15', '2026-03-01'] as const;

/** One requested range, as sortable `YYYY-MM-DD` bank days. */
interface IRange {
  readonly from: string;
  readonly to: string;
}

/** Simulated server-side session: every get428Index range it was asked. */
interface ISession {
  readonly ranges: IRange[];
}

/** Server reply for one path. */
type Route = (session: ISession, body: Readonly<Record<string, unknown>>) => Procedure<unknown>;

/**
 * A `DD/MM/YYYY` wire day as a sortable `YYYY-MM-DD` day.
 * @param wire - Day as sent in `inFromDate` / `inToDate`.
 * @returns The same day, comparable as a string.
 */
function isoDay(wire: unknown): string {
  const [day, month, year] = String(wire).split('/');
  return `${year}-${month}-${day}`;
}

/**
 * The oldest bank day the server serves under the current (fake) clock.
 * @returns Floor day as `YYYY-MM-DD`.
 */
function floorDay(): string {
  const now = new Date();
  return bankMomentOfInstant(now).subtract(HISTORY_DAYS, 'days').format('YYYY-MM-DD');
}

/**
 * One synthetic posted movement, shaped like the captured row (fake values).
 * @param day - Movement day as `YYYY-MM-DD`.
 * @returns Raw get428Index row.
 */
function movementOn(day: string): object {
  const dates = { MC02PeulaTaaEZ: `${day}T00:00:00`, MC02ErehTaaEZ: `${day}T00:00:00` };
  const ref = { MC02AsmahtaMekoritEZ: day.replaceAll('-', ''), MC02SchumEZ: -1 };
  const kind = { RecTypeSpecified: true, RecType: 1, IsTodayTransaction: false };
  return { ...kind, ...dates, ...ref, MC02TnuaTeurEZ: `FAKE ${day}` };
}

/**
 * `SkyOSH/get428Index` — refuses a range the live server answers with HTTP
 * 500, else serves the movements inside it; then bank midnight passes.
 * @param session - Simulated session.
 * @param body - Request body.
 * @returns get428Index reply, or the simulated HTTP 500.
 */
function pageReply(session: ISession, body: Readonly<Record<string, unknown>>): Procedure<unknown> {
  const range = { from: isoDay(body.inFromDate), to: isoDay(body.inToDate) };
  session.ranges.push(range);
  const isRefused = range.from > range.to || range.from < floorDay();
  jest.setSystemTime(NEXT_DAY);
  if (isRefused) return fail(ScraperErrorTypes.Generic, 'HTTP 500');
  const inside = MOVEMENT_DAYS.filter((day): boolean => day >= range.from && day <= range.to);
  const rows = inside.map(movementOn);
  return succeed({ body: { fields: null, table: { rows, isHasMoreRows: false } } });
}

const ROUTES: ReadonlyMap<string, Route> = new Map<string, Route>([
  ['SkyBL/logon', (): Procedure<unknown> => succeed({ body: { user: { Accounts: [ACCOUNT] } } })],
  ['SkyBL/changeAccount', (): Procedure<unknown> => succeed({ body: ACCOUNT })],
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
  return route(session, record);
}

/**
 * Run the real driver against a fresh simulated session.
 * @returns The session (ranges recorded) and the scrape promise.
 */
function runScrape(): { session: ISession; run: MizrahiScrapeRun } {
  const session: ISession = { ranges: [] };
  const bus = makeServedBus((url, body): Procedure<unknown> => serve(session, url, body));
  const run = scrapeOver(bus, { start: START, end: NOW });
  return { session, run };
}

describe('Mizrahi backfill at the history floor', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks the new floor day alone after bank midnight, then stops', async () => {
    const { session, run } = runScrape();
    await run;
    expect(session.ranges).toEqual([
      { from: '2025-03-15', to: '2026-03-15' },
      { from: '2025-03-16', to: '2025-03-16' },
    ]);
  });

  it('keeps every movement instead of failing the scrape', async () => {
    const { run } = runScrape();
    const result = await run;
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const days = scrape.value.accounts[0].txns.map((txn): string => txn.description);
    const sorted = [...days].sort();
    expect(sorted).toEqual(['FAKE 2025-03-15', 'FAKE 2026-03-01']);
  });
});
