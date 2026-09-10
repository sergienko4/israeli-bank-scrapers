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
import { bankMomentOfInstant } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import type { IEvidenceLedger } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import { makeEvidenceLedger } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import { classifyWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverageVerdict.js';
import { MAX_BACKFILL_ASKS } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/WindowBackfill.js';
import type { ICollectedRows } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeBackfill.js';
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
 *
 * <p>Rendered in the bank's calendar, not the host's. The bound is an absolute
 * instant that the shapes format through `bankMomentOfInstant`, so a helper
 * that reads it back with local `Date` getters asserts the runner's timezone
 * rather than the behaviour. `jest.config.js` pins TZ=Asia/Jerusalem but
 * `jest.pipeline.config.cjs` does not, so an ambient read here passes locally
 * and reports the wrong day on a host east of Israel.
 * @param ctx - Action context carrying the current window bound.
 * @returns The bound's bank-calendar day, or `none` on the first ask.
 */
function boundKey(ctx: IActionContext): string {
  if (!ctx.windowEnd.has) return 'none';
  return bankMomentOfInstant(ctx.windowEnd.value).format('YYYY-MM-DD');
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
 * Build a mediator that answers from a replies table and records each bound.
 * @param seen - Bounds the loop asked under, appended to in call order.
 * @param replies - Rows to serve, keyed by the bound the request carried.
 * @returns A mediator serving only the transactions query.
 */
function makeBus(seen: string[], replies: Record<string, readonly IRow[]> = REPLIES): IApiMediator {
  const apiQuery = jest.fn(
    async (_op: unknown, variables: Record<string, unknown>): Promise<Procedure<unknown>> => {
      await Promise.resolve();
      const key = String(variables.end);
      seen.push(key);
      return succeed({ items: replies[key] ?? [] });
    },
  );
  const stubs = makeRecoverySessionStubs();
  const base = { apiPost: jest.fn(), apiGet: jest.fn(), apiQuery, ...stubs };
  return { ...base, setBearer: jest.fn(), setRawAuth: jest.fn() } as unknown as IApiMediator;
}

/**
 * Drive one account's walk against a bound-recording mediator.
 * @param bus - The provider to answer from.
 * @param shape - The shape whose stance the walk should honour.
 * @returns Everything the walk collected, including the backfill outcome.
 */
async function collect(bus: IApiMediator, shape: unknown = SHAPE): Promise<ICollectedRows> {
  return (await collectWithLedger(bus, shape)).collected;
}

/** One walk's rows plus the evidence its guardrails recorded along the way. */
interface IWalkAudit {
  readonly collected: ICollectedRows;
  readonly ledger: IEvidenceLedger;
}

/**
 * Drive one account's walk and keep the ledger it reported into.
 *
 * The ledger is account-scoped and lives on the account context, so a test can
 * hold the same instance the walk writes to and read it once the walk is done.
 *
 * @param bus - The provider to answer from.
 * @param shape - The shape whose stance the walk should honour.
 * @param startDate - The window start the caller asked for.
 * @returns Everything the walk collected, plus the evidence it gathered.
 */
async function collectWithLedger(
  bus: IApiMediator,
  shape: unknown = SHAPE,
  startDate: Date = REQUESTED_START,
): Promise<IWalkAudit> {
  const options = { startDate } as IPipelineContext['options'];
  const base = makeMockContext({ apiMediator: some(bus), options });
  const ctx = { ...base, windowEnd: none() } as unknown as IActionContext;
  const ledger = makeEvidenceLedger();
  const acctCtx = { shape, bus, ctx, acct: { id: 'acct-1' }, ledger };
  const result = await collectAccountRows(acctCtx as unknown as IAcctCtx<IAcct, string>);
  const isSuccess = isOk(result);
  expect(isSuccess).toBe(true);
  return { collected: (result as { value: ICollectedRows }).value, ledger };
}

/**
 * Run the loop for one account against a bound-recording mediator.
 * @param seen - Bounds the loop asked under, appended to in call order.
 * @returns Every raw row the account yielded.
 */
async function runLoop(seen: string[]): Promise<readonly IRow[]> {
  const bus = makeBus(seen);
  const collected = await collect(bus);
  return collected.rows as readonly IRow[];
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

/** The single day a stalling provider keeps re-serving. */
const STALL_DAY = '2026-04-10';

/** Rows a provider serves when it will not go back past {@link STALL_DAY}. */
const STALLED_REPLIES: Record<string, readonly IRow[]> = {
  none: [{ date: STALL_DAY, id: 'only' }],
  [STALL_DAY]: [{ date: STALL_DAY, id: 'only' }],
};

/**
 * The calendar day before a given one.
 * @param day - A `YYYY-MM-DD` calendar day.
 * @returns The day preceding it, in the same form.
 */
function dayBefore(day: string): string {
  const when = new Date(`${day}T00:00:00Z`);
  when.setUTCDate(when.getUTCDate() - 1);
  return when.toISOString().slice(0, 10);
}

/**
 * A provider that always serves one row a day older than the bound it was
 * asked under, so every ask makes progress yet the requested start is never
 * reached. Models a bank that will keep paging backwards indefinitely.
 *
 * @param seen - Bounds the loop asked under, appended to in call order.
 * @returns A mediator whose window recedes one day per ask.
 */
function makeRecedingBus(seen: string[]): IApiMediator {
  const apiQuery = jest.fn(
    async (_op: unknown, variables: Record<string, unknown>): Promise<Procedure<unknown>> => {
      await Promise.resolve();
      const key = String(variables.end);
      seen.push(key);
      const day = key === 'none' ? STALL_DAY : dayBefore(key);
      return succeed({ items: [{ date: day, id: day }] });
    },
  );
  const stubs = makeRecoverySessionStubs();
  const base = { apiPost: jest.fn(), apiGet: jest.fn(), apiQuery, ...stubs };
  return { ...base, setBearer: jest.fn(), setRawAuth: jest.fn() } as unknown as IApiMediator;
}

/** The same shape, but declaring a stance that forbids any re-ask. */
const UNBACKFILLABLE_SHAPE = {
  ...SHAPE,
  transactions: { ...SHAPE.transactions, windowNarrowing: 'lowerBoundOnly' },
};

describe('collectAccountRows/completeness', () => {
  it('reports not-exhausted when the walk reaches back past the start', async () => {
    const bus = makeBus([]);
    const collected = await collect(bus);
    expect(collected.isBackfillExhausted).toBe(false);
  });

  it('reports exhausted when a re-ask yields nothing older', async () => {
    const bus = makeBus([], STALLED_REPLIES);
    const collected = await collect(bus);
    expect(collected.isBackfillExhausted).toBe(true);
  });

  it('reports exhausted when the ask budget runs out short of the start', async () => {
    const bus = makeRecedingBus([]);
    const collected = await collect(bus);
    expect(collected.isBackfillExhausted).toBe(true);
  });

  it('spends exactly the ask ceiling before giving up', async () => {
    const seen: string[] = [];
    const bus = makeRecedingBus(seen);
    await collect(bus);
    expect(seen).toHaveLength(MAX_BACKFILL_ASKS + 1);
  });

  it('still returns every row it did manage to collect', async () => {
    const bus = makeBus([], STALLED_REPLIES);
    const collected = await collect(bus);
    expect(collected.rows).toHaveLength(1);
  });

  it('does not claim exhaustion when the stance forbade asking at all', async () => {
    const bus = makeBus([], STALLED_REPLIES);
    const collected = await collect(bus, UNBACKFILLABLE_SHAPE);
    expect(collected.isBackfillExhausted).toBe(false);
  });

  it('issues no re-ask at all under a stance that forbids it', async () => {
    const seen: string[] = [];
    const bus = makeBus(seen, STALLED_REPLIES);
    await collect(bus, UNBACKFILLABLE_SHAPE);
    expect(seen).toEqual(['none']);
  });
});

/**
 * Rows that already reach back past {@link REQUESTED_START} on the first page.
 *
 * They matter because they make `assessWindowCoverage` return `covered`: the
 * oldest row is older than the requested start, so the date test alone is
 * satisfied and no backfill is earned. Any truncation on this account is
 * therefore invisible to the window verdict.
 */
const REACHING_ROWS: readonly IRow[] = [
  { date: '2026-04-10', id: 'recent' },
  { date: '2025-12-25', id: 'old' },
];

/**
 * Read rows out of a reply while deriving the same cursor every time.
 *
 * A provider whose boundary day cannot be split derives its own cursor again,
 * and `fetchPaginated` halts on the repeat rather than recursing. That halt is
 * the evidence this test is about: it proves the walk stopped before the
 * provider said it was finished.
 *
 * @param args - Extraction args bundle.
 * @param args.body - The response payload this page came from.
 * @returns The page's rows under a cursor that never advances.
 */
function stuckExtractPage(args: { body: unknown }): {
  items: readonly object[];
  nextCursor: string;
} {
  const body = args.body as { items: readonly IRow[] };
  return { items: body.items, nextCursor: 'stuck' };
}

/** Shape whose paginator can never advance past its first cursor. */
const STUCK_CURSOR_SHAPE = {
  ...SHAPE,
  transactions: {
    ...SHAPE.transactions,
    extractPage: stuckExtractPage,
    pagesMayOverlap: true,
  },
} as unknown as IApiDirectScrapeShape<IAcct, string>;

describe('collectAccountRows/a walk the paginator halted early', () => {
  it('records that pagination stopped before the provider was finished', async () => {
    const bus = makeBus([], { none: REACHING_ROWS });
    const collected = await collect(bus, STUCK_CURSOR_SHAPE);
    expect(collected.termination).toBe('cursorRepeat');
  });

  it('reports the halt as evidence, not only as a log line', async () => {
    const bus = makeBus([], { none: REACHING_ROWS });
    const audit = await collectWithLedger(bus, STUCK_CURSOR_SHAPE);
    const reported = audit.ledger.caveats();
    expect(reported).toEqual(['paginationStoppedEarly']);
  });
});

/**
 * Read rows out of a reply while offering a fresh cursor.
 *
 * The walk has to be *able* to continue for the stop predicate to be what ends
 * it: a page that reports itself final terminates as `exhausted` and never
 * exercises the predicate at all.
 *
 * @param args - Extraction args bundle.
 * @param args.body - The response payload this page came from.
 * @returns The page's rows under a cursor that invites another round.
 */
function advancingExtractPage(args: { body: unknown }): {
  items: readonly object[];
  nextCursor: string;
} {
  const body = args.body as { items: readonly IRow[] };
  return { items: body.items, nextCursor: 'more' };
}

/**
 * Stop once the oldest row held already predates the requested start.
 *
 * OneZero's own predicate in miniature. It fires precisely when the window is
 * provably covered, so it reports sufficiency — never loss.
 *
 * @param acc - Rows accumulated so far, oldest last.
 * @returns True once the held rows reach past the requested start.
 */
function coveredStop(acc: readonly object[]): boolean {
  const rows = acc as readonly IRow[];
  const oldest = rows.at(-1);
  if (oldest === undefined) return false;
  const day = new Date(oldest.date);
  return day < REQUESTED_START;
}

/** Shape that ends its walk on an intentional, correctness-driven stop. */
const COVERED_STOP_SHAPE = {
  ...SHAPE,
  transactions: {
    ...SHAPE.transactions,
    extractPage: advancingExtractPage,
    stop: coveredStop,
  },
} as unknown as IApiDirectScrapeShape<IAcct, string>;

describe('collectAccountRows/a walk its own stop rule ended', () => {
  it('ends on the predicate rather than on exhaustion', async () => {
    const bus = makeBus([], { none: REACHING_ROWS });
    const collected = await collect(bus, COVERED_STOP_SHAPE);
    expect(collected.termination).toBe('predicateStop');
  });

  it('records no loss when the walk stopped because it had enough', async () => {
    // The predicate fires only once the rows already reach past the requested
    // start. Calling that "stopped early" would downgrade every clean OneZero
    // window from `covered` to `lowerBoundReached` — the best outcome the
    // scrape can reach, reported as a qualified one, on every single run.
    const bus = makeBus([], { none: REACHING_ROWS });
    const audit = await collectWithLedger(bus, COVERED_STOP_SHAPE);
    const reported = audit.ledger.caveats();
    expect(reported).toEqual([]);
  });
});

/**
 * Replies whose first ask stops short and whose backfill round completes.
 *
 * The first ask returns one row, well inside the window, under a cursor the
 * shape re-derives — so that round halts. The backfill ask then reaches back
 * past the requested start and exhausts cleanly. This is the sequence that
 * would erase the halt if evidence were kept per round rather than per account.
 */
const HALT_THEN_RECOVER: Record<string, readonly IRow[]> = {
  none: [{ date: '2026-04-10', id: 'partial' }],
  '2026-04-10': [
    { date: '2026-04-10', id: 'partial' },
    { date: '2025-12-25', id: 'old' },
  ],
};

/**
 * Halt on the single-row page, run clean once the backfill ask widens it.
 * @param args - Extraction args bundle.
 * @param args.body - The response payload this page came from.
 * @returns The page's rows, cursor repeating only while the page is short.
 */
function haltThenRecoverExtractPage(args: { body: unknown }): {
  items: readonly object[];
  nextCursor: string | false;
} {
  const body = args.body as { items: readonly IRow[] };
  const isShort = body.items.length < 2;
  return { items: body.items, nextCursor: isShort ? 'stuck' : false };
}

/** Shape that halts on its first round and then completes on the backfill ask. */
const HALT_THEN_RECOVER_SHAPE = {
  ...SHAPE,
  transactions: {
    ...SHAPE.transactions,
    extractPage: haltThenRecoverExtractPage,
    pagesMayOverlap: true,
  },
} as unknown as IApiDirectScrapeShape<IAcct, string>;

describe('collectAccountRows/evidence across backfill rounds', () => {
  it('keeps an early halt after a later round completes cleanly', async () => {
    const seen: string[] = [];
    const bus = makeBus(seen, HALT_THEN_RECOVER);
    const audit = await collectWithLedger(bus, HALT_THEN_RECOVER_SHAPE);
    expect(seen).toContain('2026-04-10');
    expect(audit.collected.termination).toBe('cursorRepeat');
    const reported = audit.ledger.caveats();
    expect(reported).toEqual(['paginationStoppedEarly']);
  });
});

describe('collectAccountRows/unreadable start', () => {
  it('keeps the account when the caller asked from an unparseable date', async () => {
    // Rendering the start used to throw here, which took the whole account
    // down before any verdict could be formed. Losing the account hides the
    // caller's own mistake behind a failure that names nothing.
    const bus = makeBus([]);
    const audit = await collectWithLedger(bus, SHAPE, new Date('not-a-date'));
    expect(audit.collected.window.requestedStart).toBe('invalid-date');
  });

  it('publishes that unreadable start as the reason the window is unproven', async () => {
    const bus = makeBus([]);
    const audit = await collectWithLedger(bus, SHAPE, new Date('not-a-date'));
    const caveats = audit.ledger.caveats();
    const verdict = classifyWindowCoverage({ ...audit.collected.window, caveats });
    const reason = verdict.status === 'unproven' ? verdict.reason : verdict.status;
    expect(reason).toBe('requestedStartUnreadable');
  });
});

/**
 * Replies whose first round stops on the shape's own rule while still short,
 * and whose backfill round then gets stuck on a repeated cursor.
 *
 * The first ask carries the marker row the predicate watches for, so that round
 * ends `predicateStop` — with the oldest row still well inside the window, so
 * backfill is earned. The backfill ask carries no marker, so the predicate
 * stays quiet and that round runs on until the cursor repeats.
 */
const ENOUGH_THEN_STUCK: Record<string, readonly IRow[]> = {
  none: [{ date: '2026-04-10', id: 'enough' }],
  '2026-04-10': [{ date: '2026-04-10', id: 'plain' }],
};

/**
 * Stop once the marker row is held.
 *
 * Stands for a bank predicate that fires for a reason of its own rather than
 * because the window is covered. That is the case where backfill still
 * follows, and so the case where a later round can still prove loss.
 *
 * @param acc - Rows accumulated so far.
 * @returns True once the marker row is among them.
 */
function markerStop(acc: readonly object[]): boolean {
  const rows = acc as readonly IRow[];
  return rows.some((r): boolean => r.id === 'enough');
}

/** Shape that stops on its own rule while short, then walks into a repeat. */
const ENOUGH_THEN_STUCK_SHAPE = {
  ...SHAPE,
  transactions: {
    ...SHAPE.transactions,
    extractPage: stuckExtractPage,
    stop: markerStop,
    pagesMayOverlap: true,
  },
} as unknown as IApiDirectScrapeShape<IAcct, string>;

describe('collectAccountRows/loss proved after a non-lossy round', () => {
  it('keeps the later lossy ending over the earlier intentional stop', async () => {
    const bus = makeBus([], ENOUGH_THEN_STUCK);
    const audit = await collectWithLedger(bus, ENOUGH_THEN_STUCK_SHAPE);
    expect(audit.collected.termination).toBe('cursorRepeat');
  });

  it('records the loss that later round proved', async () => {
    // A fold that keeps the first non-`exhausted` answer holds `predicateStop`
    // forever. Since that is not loss, the `cursorRepeat` behind it is never
    // reported, and an account that provably lost rows is published as clean.
    const bus = makeBus([], ENOUGH_THEN_STUCK);
    const audit = await collectWithLedger(bus, ENOUGH_THEN_STUCK_SHAPE);
    const reported = audit.ledger.caveats();
    expect(reported).toEqual(['paginationStoppedEarly']);
  });
});
