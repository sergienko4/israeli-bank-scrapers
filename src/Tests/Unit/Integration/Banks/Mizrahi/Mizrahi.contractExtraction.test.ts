/**
 * Mizrahi — contract extraction binding (Mode A/B value proof).
 *
 * <p>The Mode B simulator drive proves the committed Mizrahi responses answer
 * the production-shaped requests, but it stops at the transport layer, and
 * the shape suite feeds each extractor one response at a time. This suite
 * closes the loop: it serves the SAME committed `SkyBL/logon`,
 * `SkyBL/changeAccount` and `SkyOSH/get428Index` responses to the REAL
 * generic headless scrape driving `MIZRAHI_SHAPE`, and pins the live API
 * contract (plan spec §5) end to end:
 *
 * <ul>
 *   <li><b>Requests</b> — each endpoint is dispatched with exactly the keys
 *   the SPA sends (real logins #6 and #12), and `get428Index` names the
 *   window in the bank's `DD/MM/YYYY` days.</li>
 *   <li><b>Responses</b> — the published account, its balance and its posted
 *   movement are the committed values, read through the keys the shape
 *   declares; the balance line and the section label stay out, and the
 *   window audits covered.</li>
 *   <li><b>Cross-check</b> — the dashboard's `OSH/Get428ODS` balance agrees
 *   with the switched account's `YitraAdkanit` (plan D17).</li>
 * </ul>
 *
 * <p>The responses are PII-redacted captures of the live test account: one
 * account, one posted movement, captured on 08/10/2026.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { MIZRAHI_API } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeHelpers.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransactionsAccount } from '../../../../../Transactions.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import {
  loadMizrahiResponse,
  makeServedBus,
  type MizrahiScrapeRun,
  scrapeOver,
} from '../../../Pipeline/Banks/Mizrahi/MizrahiBusFactory.js';

/** Clock pinned to midday of the capture day (12:00 IDT, 08/10/2026). */
const END = new Date('2026-10-08T09:00:00.000Z');
/** Start on the posted movement's bank day (07/10/2026), so no backfill. */
const START = new Date('2026-10-06T21:00:00.000Z');

/** Committed response served for each contract path. */
const FIXTURE_OF: ReadonlyMap<string, string> = new Map([
  ['SkyBL/logon', 'logon'],
  ['SkyBL/changeAccount', 'changeAccount'],
  ['SkyOSH/get428Index', 'transactions'],
]);

/** Raw logon fields the contract reads. */
interface ILogonFixture {
  readonly body: { readonly user: { readonly Accounts: readonly ISwitched[] } };
}

/** Raw changeAccount fields the contract reads. */
interface ISwitched {
  readonly SnifAndNumber400: string;
  readonly YitraAdkanit: number;
}

/** Raw get428Index row fields the contract reads. */
interface IPageRow {
  readonly RecTypeSpecified: boolean;
  readonly MC02AsmahtaMekoritEZ: string | null;
  readonly MC02SchumEZ?: number;
  readonly MC02TnuaTeurEZ: string;
}

const LOGON = loadMizrahiResponse('logon') as unknown as ILogonFixture;
const SWITCHED = loadMizrahiResponse('changeAccount').body as ISwitched;
const PAGE = loadMizrahiResponse('transactions') as { body: { table: { rows: IPageRow[] } } };
const DASHBOARD = loadMizrahiResponse('balance') as { body: { itra: { itra: string } } };

/** One recorded apiPost dispatch — the path under the API origin. */
interface ICall {
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/**
 * Serve one dispatch with its committed response, recording the call.
 * @param calls - Recorded dispatches.
 * @param url - Dispatched URL.
 * @param body - Dispatched body.
 * @returns The committed response, or a failure for a path off the contract.
 */
function serveFixture(calls: ICall[], url: string, body: unknown): Procedure<unknown> {
  const path = url.replace(`${MIZRAHI_API}/`, '');
  const fixture = FIXTURE_OF.get(path);
  if (fixture === undefined) return fail(ScraperErrorTypes.Generic, `unexpected url=${url}`);
  calls.push({ path, body: (body ?? {}) as Readonly<Record<string, unknown>> });
  const reply = loadMizrahiResponse(fixture);
  return succeed(reply);
}

/**
 * Run the real driver against the committed responses.
 * @returns The recorded calls and the scrape promise.
 */
function runContract(): { calls: readonly ICall[]; run: MizrahiScrapeRun } {
  const calls: ICall[] = [];
  const bus = makeServedBus((url, body): Procedure<unknown> => serveFixture(calls, url, body));
  const run = scrapeOver(bus, { start: START, end: END });
  return { calls, run };
}

/**
 * The accounts a contract run publishes.
 * @returns Published accounts.
 */
async function publishedAccounts(): Promise<readonly ITransactionsAccount[]> {
  const { run } = runContract();
  const result = await run;
  assertOk(result);
  const scrape = result.value.scrape;
  assertHas(scrape);
  return scrape.value.accounts;
}

/**
 * The key set of one dispatched body and, for get428Index, of its paging
 * table.
 * @param call - Recorded dispatch.
 * @returns Path and key sets.
 */
function requestKeysOf(call: ICall): object {
  const keys = new Set(Object.keys(call.body));
  const table = call.body.table;
  if (table === undefined) return { path: call.path, keys };
  return { path: call.path, keys, table: new Set(Object.keys(table as object)) };
}

describe('Mizrahi contract extraction — the real driver on the committed responses', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: END });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispatches each endpoint with exactly the keys the SPA sends', async () => {
    const { calls, run } = runContract();
    assertOk(await run);
    const requests = calls.map(requestKeysOf);
    expect(requests).toEqual([
      { path: 'SkyBL/logon', keys: new Set(['appId', 'appVer', 'lang', 'isPdf']) },
      { path: 'SkyBL/changeAccount', keys: new Set(['selectedAccountIndex']) },
      {
        path: 'SkyOSH/get428Index',
        keys: new Set(['inFromDate', 'inToDate', 'inSugTnua', 'isFromSearch', 'table']),
        table: new Set(['startRowIndex', 'maxRow', 'actionGuid', 'sortExpression']),
      },
    ]);
  });

  it("names the window in the bank's DD/MM/YYYY days", async () => {
    const { calls, run } = runContract();
    assertOk(await run);
    const pages = calls.filter((call): boolean => call.path === 'SkyOSH/get428Index');
    const ranges = pages.map((call): object => ({
      from: call.body.inFromDate,
      to: call.body.inToDate,
    }));
    expect(ranges).toEqual([{ from: '07/10/2026', to: '08/10/2026' }]);
  });

  it('publishes the logon account with its switched balance', async () => {
    const accounts = await publishedAccounts();
    const published = accounts.map((acct): object => ({
      accountNumber: acct.accountNumber,
      balance: acct.balance,
    }));
    const [logonAccount] = LOGON.body.user.Accounts;
    const expected = {
      accountNumber: logonAccount.SnifAndNumber400,
      balance: SWITCHED.YitraAdkanit,
    };
    expect(published).toEqual([expected]);
  });

  it('maps only the posted movement — the balance and label lines stay out', async () => {
    const accounts = await publishedAccounts();
    const mapped = accounts.flatMap((acct): object[] =>
      acct.txns.map((txn): object => [txn.identifier, txn.chargedAmount, txn.description]),
    );
    const posted = PAGE.body.table.rows.filter((row): boolean => row.RecTypeSpecified);
    const expected = posted.map((row): object => [
      row.MC02AsmahtaMekoritEZ,
      row.MC02SchumEZ,
      row.MC02TnuaTeurEZ,
    ]);
    expect(PAGE.body.table.rows).toHaveLength(3);
    expect(mapped).toEqual(expected);
  });

  it('audits the window covered on every account', async () => {
    const accounts = await publishedAccounts();
    const statuses = accounts.map((acct): unknown => acct.windowCoverage?.status);
    expect(statuses).toEqual(['covered']);
  });

  it("agrees with the dashboard's Get428ODS balance", () => {
    const dashboard = Number(DASHBOARD.body.itra.itra);
    expect(dashboard).toBe(SWITCHED.YitraAdkanit);
  });
});
