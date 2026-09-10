/**
 * Can the overlap collapse silently lose a real transaction?
 *
 * <p>`dropOverlap` reconciles the re-asked boundary day by multiset difference
 * on the serialized row. Its header concedes two genuinely distinct rows can
 * serialize identically and argues safety from the re-ask carrying *both*
 * copies. A reviewer proposed a hole: if the re-ask carries only one copy of a
 * tied pair, the held copy's tally is spent on it and a real transaction
 * disappears with nothing recorded.
 *
 * <p>That was reasoning, not an observed run, so these tests try to make it
 * happen against a provider rather than against the function in isolation.
 * The answer turns out to depend entirely on one property of the provider,
 * which is named and pinned below.
 */

import { jest } from '@jest/globals';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { IEvidenceLedger } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import { makeEvidenceLedger } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import { classifyWindowCoverage } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverageVerdict.js';
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
import type { IWindowCoverage } from '../../../../../WindowCoverage.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** Start of the window the caller asks for. */
const REQUESTED_START = new Date('2026-01-01T00:00:00Z');

/**
 * One row exactly as it reaches the wire.
 *
 * <p>Deliberately carries no identifier: the whole question is what happens to
 * two distinct transactions that serialize identically, so the fixture has to
 * be able to produce them.
 */
interface IWireRow {
  readonly date: string;
  readonly amount: number;
  readonly desc: string;
}

/** A provider-side transaction, with test-only bookkeeping the wire never sees. */
interface ITruthRow {
  readonly wire: IWireRow;
  /** Distinguishes copies that serialize identically. Never sent. */
  readonly tag: string;
}

/**
 * The provider's whole ledger, newest first.
 *
 * <p>`t-a` and `t-b` are two different transactions on the same day for the
 * same amount to the same merchant — a pair of identical coffees, the case the
 * header calls out. On the wire they are indistinguishable.
 */
const TRUTH: readonly ITruthRow[] = [
  { tag: 'newest', wire: { date: '2026-03-10', amount: 100, desc: 'rent' } },
  { tag: 't-a', wire: { date: '2026-03-05', amount: 50, desc: 'coffee' } },
  { tag: 't-b', wire: { date: '2026-03-05', amount: 50, desc: 'coffee' } },
  { tag: 'oldest', wire: { date: '2026-03-01', amount: 20, desc: 'bus' } },
];

/** How a provider orders and truncates one reply. */
type Ordering = 'monotone' | 'inconsistent';

/** Everything one simulated provider needs to answer a request. */
interface IProviderCfg {
  readonly cap: number;
  readonly ordering: Ordering;
}

/** Replies served so far, so a provider can answer differently the second time. */
interface ICallCount {
  count: number;
}

/**
 * Rows at or before the requested bound, newest first.
 * @param bound - Upper bound as YYYY-MM-DD.
 * @returns The in-window slice of the ledger.
 */
function inWindow(bound: string): readonly ITruthRow[] {
  return TRUTH.filter((r): boolean => r.wire.date <= bound);
}

/**
 * Serve one copy per identical group, simulating a provider that reconciles
 * server-side — the only shape that can hand back fewer copies than it holds.
 * @param rows - In-window rows, newest first.
 * @returns The same rows with identical duplicates collapsed.
 */
function collapseTies(rows: readonly ITruthRow[]): readonly ITruthRow[] {
  const seen = new Set<string>();
  return rows.filter((r): boolean => {
    const key = JSON.stringify(r.wire);
    const isFresh = !seen.has(key);
    seen.add(key);
    return isFresh;
  });
}

/**
 * Whether this particular reply should hold a tied copy back.
 *
 * <p>The first reply is always complete: a provider that *always* collapsed
 * ties would simply have one coffee as far as any client can ever tell, and
 * nothing would be lost. The hole needs a provider that reveals both copies
 * once and only one of them on the re-ask — inconsistency, not de-duplication.
 *
 * @param cfg - Cap and ordering this provider obeys.
 * @param calls - Replies served so far for this account.
 * @returns True when this reply should collapse identical rows.
 */
function shouldCollapse(cfg: IProviderCfg, calls: ICallCount): boolean {
  return cfg.ordering === 'inconsistent' && calls.count > 1;
}

/**
 * One reply from a simulated provider.
 * @param bound - Upper bound the request carried.
 * @param cfg - Cap and ordering this provider obeys.
 * @param calls - Replies served so far for this account.
 * @returns The rows the provider chose to serve.
 */
function reply(bound: string, cfg: IProviderCfg, calls: ICallCount): readonly IWireRow[] {
  const windowed = inWindow(bound);
  const ordered = shouldCollapse(cfg, calls) ? collapseTies(windowed) : windowed;
  const capped = ordered.slice(0, cfg.cap);
  return capped.map((r): IWireRow => r.wire);
}

/**
 * Read the bound off the context as YYYY-MM-DD, or the ledger's newest day.
 * @param ctx - Action context carrying the (possibly unset) bound.
 * @returns Upper bound for this request.
 */
function boundKey(ctx: IActionContext): string {
  if (!ctx.windowEnd.has) return '2026-12-31';
  const when = ctx.windowEnd.value;
  const year = when.getFullYear();
  const monthIndex = when.getMonth();
  const dayOfMonth = when.getDate();
  const m = String(monthIndex + 1).padStart(2, '0');
  const d = String(dayOfMonth).padStart(2, '0');
  return `${String(year)}-${m}-${d}`;
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
function noAccounts(): object[] {
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
 * Account number for the synthetic account.
 * @returns A fixed identifier.
 */
function accountNumberOf(): string {
  return 'acct-1';
}

/**
 * Surface the bound so the simulated provider can answer against it.
 * @param _a - Account reference, unused.
 * @param _c - Cursor, unused; one page per bound.
 * @param ctx - Action context carrying the bound.
 * @returns Variables naming the bound this request carries.
 */
function txnVars(_a: object, _c: string | false, ctx: IActionContext): object {
  const end = boundKey(ctx);
  return { end };
}

/**
 * Read the rows out of a reply.
 * @param args - Extraction args bundle.
 * @param args.body - The response payload this page came from.
 * @returns The page's rows, with pagination already exhausted.
 */
function txnExtractPage(args: { body: unknown }): {
  items: readonly object[];
  nextCursor: false;
} {
  const body = args.body as { items: readonly IWireRow[] };
  return { items: body.items, nextCursor: false };
}

const SHAPE = {
  stepName: 'OverlapIdentityTestShape',
  accountNumberOf,
  customer: { buildVars: noVars, extractAccounts: noAccounts },
  balance: { buildVars: noVars, extract: noBalance },
  transactions: {
    buildVars: txnVars,
    extractPage: txnExtractPage,
    windowNarrowing: 'windowEnd',
    pagesMayOverlap: true,
  },
} as unknown as IApiDirectScrapeShape<object, string>;

/**
 * Build a mediator answering from a simulated provider.
 * @param cfg - Cap and ordering the provider obeys.
 * @returns A mediator serving only the transactions query.
 */
function makeBus(cfg: IProviderCfg): IApiMediator {
  const calls: ICallCount = { count: 0 };
  const apiQuery = jest.fn(
    async (_op: unknown, variables: Record<string, unknown>): Promise<Procedure<unknown>> => {
      await Promise.resolve();
      calls.count += 1;
      const bound = String(variables.end);
      return succeed({ items: reply(bound, cfg, calls) });
    },
  );
  const stubs = makeRecoverySessionStubs();
  const base = { apiPost: jest.fn(), apiGet: jest.fn(), apiQuery, ...stubs };
  return { ...base, setBearer: jest.fn(), setRawAuth: jest.fn() } as unknown as IApiMediator;
}

/** What one walk produced: its rows, and what it may honestly claim. */
interface IWalkOutcome {
  readonly rows: readonly object[];
  readonly coverage: IWindowCoverage;
}

/**
 * Assemble the per-account context one walk runs against.
 * @param cfg - Cap and ordering the provider obeys.
 * @param ledger - Evidence ledger the walk reports into.
 * @returns The account context `collectAccountRows` expects.
 */
function buildAcctCtx(cfg: IProviderCfg, ledger: IEvidenceLedger): IAcctCtx<object, string> {
  const options = { startDate: REQUESTED_START } as IPipelineContext['options'];
  const bus = makeBus(cfg);
  const base = makeMockContext({ apiMediator: some(bus), options });
  const ctx = { ...base, windowEnd: none() } as unknown as IActionContext;
  const acctCtx = { shape: SHAPE, bus, ctx, acct: {}, ledger };
  return acctCtx;
}

/**
 * Drive one walk and classify what it is entitled to claim.
 * @param cfg - Cap and ordering the provider obeys.
 * @returns The rows collected and the verdict published for them.
 */
async function walkOutcome(cfg: IProviderCfg): Promise<IWalkOutcome> {
  const ledger = makeEvidenceLedger();
  const acctCtx = buildAcctCtx(cfg, ledger);
  const result = await collectAccountRows(acctCtx);
  const isSuccess = isOk(result);
  expect(isSuccess).toBe(true);
  const got = (result as { value: ICollectedRows }).value;
  const caveats = ledger.caveats();
  const coverage = classifyWindowCoverage({ ...got.window, caveats });
  return { rows: got.rows, coverage };
}

/**
 * How many rows the walk brought back for a given day.
 * @param rows - Rows the walk collected.
 * @param date - Day to count, as YYYY-MM-DD.
 * @returns Number of rows on that day.
 */
function countOn(rows: readonly object[], date: string): number {
  const wire = rows as readonly IWireRow[];
  const onDay = wire.filter((r): boolean => r.date === date);
  return onDay.length;
}

/** Every cap that can split the tied pair, plus ones either side of it. */
const CAPS = [1, 2, 3, 4, 5];

/** Both provider behaviours, so no assertion below holds for only one. */
const ORDERINGS: readonly Ordering[] = ['monotone', 'inconsistent'];

/** The day carrying the two identical coffees. */
const TIED_DAY = '2026-03-05';

/** How many identical coffees the provider actually holds on {@link TIED_DAY}. */
const TIED_COPIES = 2;

describe('dropOverlap/identical rows across a re-asked day', () => {
  /**
   * The property that actually matters. A walk may legitimately come back with
   * one coffee — a cap can stop it before the second is reachable — but it may
   * never come back with one coffee *and* tell the caller the window is
   * covered. Asserting the pair, rather than the row count alone, is what
   * makes this test survive a change to the cap or the walk's stopping rule.
   */
  it.each(ORDERINGS)('never claims a covered window while short of rows (%s)', async ordering => {
    const pending = CAPS.map(async (cap): Promise<readonly [number, string]> => {
      const out = await walkOutcome({ cap, ordering });
      const coffees = countOn(out.rows, TIED_DAY);
      return [coffees, out.coverage.status] as const;
    });
    const outcomes = await Promise.all(pending);
    const dishonest = outcomes.filter(([coffees, status]): boolean => {
      const isShort = coffees < TIED_COPIES;
      return isShort && status === 'covered';
    });
    expect(dishonest).toEqual([]);
  });

  /**
   * The collapse must not over-correct either: when the re-ask does carry both
   * copies, both have to survive it. This is the case the header was written
   * for, and it is the one a set-based identity would silently break.
   */
  it.each(ORDERINGS)('recovers both copies once the re-ask can reach them (%s)', async ordering => {
    const out = await walkOutcome({ cap: 4, ordering });
    const coffees = countOn(out.rows, TIED_DAY);
    expect(coffees).toBe(TIED_COPIES);
  });

  /**
   * The reviewer's scenario, driven end to end: a provider that reveals both
   * copies once and only one of them on the re-ask. It does not lose a row —
   * the tally the collapse spends is a copy the provider just re-served, and
   * the copies already held are never touched. Recorded because "we could not
   * make it happen" is only worth anything if the attempt is in the tree.
   */
  it('survives a provider that reveals both copies once and one of them later', async () => {
    const out = await walkOutcome({ cap: 3, ordering: 'inconsistent' });
    const coffees = countOn(out.rows, TIED_DAY);
    expect(coffees).toBe(TIED_COPIES);
  });
});
