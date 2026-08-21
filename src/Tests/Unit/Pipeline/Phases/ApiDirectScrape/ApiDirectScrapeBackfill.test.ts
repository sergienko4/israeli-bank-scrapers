/**
 * Direct cover for the per-account backfill loop, `collectAccountRows`.
 *
 * The loop's parts were each tested — coverage assessment, `planBackfill`,
 * `dropOverlap` — but nothing drove them together, and that is exactly where
 * the transaction loss lived: the bound the loop derived never reached the
 * wire in any test, so a bound that excluded the oldest day looked correct in
 * every unit and lost rows in production.
 *
 * The bank modelled here caps by row count rather than by day, so its first
 * reply holds back part of a day. Only an inclusive re-ask of that day can
 * recover the remainder.
 */

import { jest } from '@jest/globals';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import collectAccountRows from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeBackfill.js';
import type { IAcctCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** One dated row, as the provider serves it. */
interface IRow {
  readonly date: string;
  readonly id: string;
}

/** Account reference the synthetic shape carries. */
interface IAcct {
  readonly id: string;
}

/** Start of the window the caller asks for. */
const REQUESTED_START = new Date('2026-01-01T00:00:00Z');

/**
 * Replies keyed by the bound the request carried.
 *
 * `none` is the first ask. The `2026-04-10` entry is the one that matters: it
 * re-serves row `a` and adds row `b`, the row the provider's count cap held
 * back. A bound set to the day *before* would never ask under this key.
 */
const REPLIES: Record<string, readonly IRow[]> = {
  none: [{ date: '2026-04-10', id: 'a' }],
  '2026-04-10': [
    { date: '2026-04-10', id: 'a' },
    { date: '2026-04-10', id: 'b' },
    { date: '2026-03-01', id: 'c' },
  ],
  '2026-03-01': [
    { date: '2026-03-01', id: 'c' },
    { date: '2025-12-25', id: 'd' },
  ],
};

/**
 * Render a bound as the calendar day the provider would key on.
 * @param ctx - Action context carrying the current window bound.
 * @returns The bound's local calendar day, or `none` on the first ask.
 */
function boundKey(ctx: IActionContext): string {
  if (!ctx.windowEnd.has) return 'none';
  const when = ctx.windowEnd.value;
  const monthIndex = when.getMonth();
  const dayOfMonth = when.getDate();
  const fullYear = when.getFullYear();
  const month = String(monthIndex + 1).padStart(2, '0');
  const day = String(dayOfMonth).padStart(2, '0');
  return `${String(fullYear)}-${month}-${day}`;
}

/**
 * Account number for the synthetic account.
 * @param a - The account reference.
 * @returns Its identifier.
 */
function accountNumberOf(a: IAcct): string {
  return a.id;
}

/**
 * Vars for the steps this test never exercises.
 * @returns An empty variables bundle.
 */
function noVars(): object {
  return {};
}

/**
 * Accounts extractor — unused; the loop is driven per account directly.
 * @returns No accounts.
 */
function noAccounts(): IAcct[] {
  return [];
}

/**
 * Balance extractor — unused by this test.
 * @returns Zero.
 */
function noBalance(): number {
  return 0;
}

/**
 * Surface the current window bound so the mediator can answer against it.
 * @param _a - Account reference, unused.
 * @param _c - Cursor, unused; this shape returns one page per bound.
 * @param ctx - Action context carrying the bound.
 * @returns Variables naming the bound this request carries.
 */
function txnVars(_a: IAcct, _c: string | false, ctx: IActionContext): object {
  const end = boundKey(ctx);
  return { end };
}

/**
 * Read the rows out of a reply. One page per bound, so the cursor never moves.
 * @param args - Extraction args bundle.
 * @param args.body - The response payload this page came from.
 * @returns The page's rows, with pagination already exhausted.
 */
function txnExtractPage(args: { body: unknown }): {
  items: readonly object[];
  nextCursor: false;
} {
  const body = args.body as { items: readonly IRow[] };
  return { items: body.items, nextCursor: false };
}

/** Shape whose transactions step declares a narrowable, overlapping walk. */
const SHAPE = {
  stepName: 'BackfillLoopTestShape',
  accountNumberOf,
  customer: { buildVars: noVars, extractAccounts: noAccounts },
  balance: { buildVars: noVars, extract: noBalance },
  transactions: {
    buildVars: txnVars,
    extractPage: txnExtractPage,
    windowNarrowing: 'windowEnd',
    pagesMayOverlap: true,
  },
} as unknown as IApiDirectScrapeShape<IAcct, string>;

/**
 * Build a mediator that answers from {@link REPLIES} and records each bound.
 * @param seen - Bounds the loop asked under, appended to in call order.
 * @returns A mediator serving only the transactions query.
 */
function makeBus(seen: string[]): IApiMediator {
  const apiQuery = jest.fn(
    async (_op: unknown, variables: Record<string, unknown>): Promise<Procedure<unknown>> => {
      await Promise.resolve();
      const key = String(variables.end);
      seen.push(key);
      return succeed({ items: REPLIES[key] ?? [] });
    },
  );
  const stubs = makeRecoverySessionStubs();
  const base = { apiPost: jest.fn(), apiGet: jest.fn(), apiQuery, ...stubs };
  return { ...base, setBearer: jest.fn(), setRawAuth: jest.fn() } as unknown as IApiMediator;
}

/**
 * Run the loop for one account against a bound-recording mediator.
 * @param seen - Bounds the loop asked under, appended to in call order.
 * @returns Every raw row the account yielded.
 */
async function runLoop(seen: string[]): Promise<readonly IRow[]> {
  const bus = makeBus(seen);
  const options = { startDate: REQUESTED_START } as IPipelineContext['options'];
  const base = makeMockContext({ apiMediator: some(bus), options });
  const ctx = { ...base, windowEnd: none() } as unknown as IActionContext;
  const acctCtx = { shape: SHAPE, bus, ctx, acct: { id: 'acct-1' } };
  const result = await collectAccountRows(acctCtx as unknown as IAcctCtx<IAcct, string>);
  return isOk(result) ? (result.value as readonly IRow[]) : [];
}

describe('collectAccountRows/a provider that caps by row count', () => {
  it('re-asks the oldest day held rather than the day before it', async () => {
    const seen: string[] = [];
    await runLoop(seen);
    expect(seen[1]).toBe('2026-04-10');
  });

  it('recovers the row the cap held back on that day', async () => {
    const rows = await runLoop([]);
    const ids = rows.map((r): string => r.id);
    expect(ids).toContain('b');
  });

  it('reports each row once, though every re-ask re-serves rows', async () => {
    const rows = await runLoop([]);
    const ids = rows.map((r): string => r.id);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('stops once the rows reach back past the requested start', async () => {
    const seen: string[] = [];
    await runLoop(seen);
    expect(seen).toEqual(['none', '2026-04-10', '2026-03-01']);
  });
});
