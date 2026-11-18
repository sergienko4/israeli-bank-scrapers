/**
 * Cross-bank characterization of today's result policy.
 *
 * <p>Every API-direct shape runs the same scrape action, but the banks answer
 * three failure classes differently. This table pins the current verdicts
 * before Phase 10 changes the policy:
 *
 * <ul>
 *   <li>balance 5xx — fail the run, or keep the account with a fallback;</li>
 *   <li>a pagination ceiling — succeed with an unproven window verdict;</li>
 *   <li>bank text in a failure — omitted unless the shape opts in.</li>
 * </ul>
 *
 * <p>The shapes' extractors are instrumented with a generic account/page so the
 * table measures the phase/guard policy, not each bank's wire parser. The real
 * `resultGuard` stays in place, which is where Leumi/PayBox differ.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { buildApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, type Procedure, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';
import {
  AMEX_SHAPE,
  BEINLEUMI_SHAPE,
  DISCOUNT_SHAPE,
  HAPOALIM_SHAPE,
  ISRACARD_SHAPE,
  LEUMI_SHAPE,
  MASSAD_SHAPE,
  MAX_SHAPE,
  MERCANTILE_SHAPE,
  MIZRAHI_SHAPE,
  ONE_ZERO_SHAPE,
  OTSAR_HAHAYAL_SHAPE,
  PAGI_SHAPE,
  PAYBOX_SHAPE,
  PEPPER_SHAPE,
  VISACAL_SHAPE,
  YAHAV_SHAPE,
} from './ApiDirectBankShapes.js';

/** The three failure classes characterized by this table. */
type Scenario = 'balance5xx' | 'pageCeiling' | 'bankText';

/** One bank shape under its display name. */
interface IShapeRow {
  readonly bank: string;
  readonly shape: IApiDirectScrapeShape<unknown, unknown>;
}

/** One row's observed verdict. */
interface IVerdict {
  readonly success: boolean;
  readonly txns?: number;
  readonly coverage?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly balanceCalls?: number;
  readonly txnCalls?: number;
}

/** A mediator plus the count of balance operations it saw. */
interface IBusResult {
  readonly bus: IApiMediator;
  readonly balanceCalls: () => number;
  readonly txnCalls: () => number;
}

/** Synthetic account handed to every instrumented shape. */
const ACCT = { id: 'acct-1' };

/** A row the generic transaction mapper accepts. */
const ROW = { date: '2026-01-15', amount: -10, description: 'x' } as const;

/** Every API-direct shape, keyed by display name. */
const SHAPES: readonly IShapeRow[] = [
  { bank: 'AMEX', shape: AMEX_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  {
    bank: 'BEINLEUMI',
    shape: BEINLEUMI_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown>,
  },
  { bank: 'DISCOUNT', shape: DISCOUNT_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'HAPOALIM', shape: HAPOALIM_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'ISRACARD', shape: ISRACARD_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'LEUMI', shape: LEUMI_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'MASSAD', shape: MASSAD_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'MAX', shape: MAX_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  {
    bank: 'MERCANTILE',
    shape: MERCANTILE_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown>,
  },
  { bank: 'MIZRAHI', shape: MIZRAHI_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'ONE_ZERO', shape: ONE_ZERO_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  {
    bank: 'OTSAR_HAHAYAL',
    shape: OTSAR_HAHAYAL_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown>,
  },
  { bank: 'PAGI', shape: PAGI_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'PAYBOX', shape: PAYBOX_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'PEPPER', shape: PEPPER_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'VISACAL', shape: VISACAL_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
  { bank: 'YAHAV', shape: YAHAV_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown> },
];

/** Banks that never make a balance call. */
const SKIPPED_BANKS: ReadonlySet<string> = new Set(['MAX', 'PAYBOX']);

/** Banks that keep the account when the balance call fails. */
const BALANCE_FALLBACK_BANKS: ReadonlySet<string> = new Set([
  'AMEX',
  'ISRACARD',
  'ONE_ZERO',
  'PAYBOX',
  'PEPPER',
  'VISACAL',
]);

/** Ceiling walks stop at 300 pages, except Hapoalim's period walk. */
const CEILING_TXNS: Readonly<Record<string, number>> = {
  AMEX: 300,
  BEINLEUMI: 300,
  DISCOUNT: 300,
  HAPOALIM: 1,
  ISRACARD: 300,
  LEUMI: 300,
  MASSAD: 300,
  MAX: 300,
  MERCANTILE: 300,
  MIZRAHI: 300,
  ONE_ZERO: 300,
  OTSAR_HAHAYAL: 300,
  PAGI: 300,
  PAYBOX: 300,
  PEPPER: 300,
  VISACAL: 300,
  YAHAV: 300,
};

/** Why each ceiling walk reports an unproven window. */
const CEILING_REASON: Readonly<Record<string, string>> = {
  AMEX: 'backfillNotSupportedForBank',
  BEINLEUMI: 'boundDidNotMove',
  DISCOUNT: 'backfillNotSupportedForBank',
  HAPOALIM: 'boundDidNotMove',
  ISRACARD: 'backfillNotSupportedForBank',
  LEUMI: 'boundDidNotMove',
  MASSAD: 'boundDidNotMove',
  MAX: 'backfillNotSupportedForBank',
  MERCANTILE: 'backfillNotSupportedForBank',
  MIZRAHI: 'boundDidNotMove',
  ONE_ZERO: 'backfillNotSupportedForBank',
  OTSAR_HAHAYAL: 'boundDidNotMove',
  PAGI: 'boundDidNotMove',
  PAYBOX: 'backfillNotSupportedForBank',
  PEPPER: 'boundDidNotMove',
  VISACAL: 'backfillNotSupportedForBank',
  YAHAV: 'boundDidNotMove',
};

/**
 * Build a mediator that answers customer, balance and transactions directly.
 * @param scenario - Failure class being injected.
 * @returns The mediator and a balance-call counter.
 */
function makeBus(scenario: Scenario): IBusResult {
  let balanceCalls = 0;
  let txnCalls = 0;
  /**
   * Answer one operation.
   * @param op - Operation label.
   * @returns The scenario's response.
   */
  const route = (op: string): Procedure<unknown> => {
    if (op === 'balance') {
      balanceCalls += 1;
      if (scenario === 'balance5xx') {
        return fail(ScraperErrorTypes.Generic, 'balance 5xx', 500);
      }
    }
    if (op === 'transactions') {
      txnCalls += 1;
      if (scenario === 'bankText') {
        return fail(ScraperErrorTypes.Generic, 'BANK-TEXT-MARKER', 500);
      }
    }
    return succeed({});
  };
  const bus = {
    /**
     * POST one GraphQL/REST operation.
     * @param op - Operation label.
     * @returns The scenario's response.
     */
    apiPost: (op: string): Promise<Procedure<unknown>> => {
      const answer = route(op);
      return Promise.resolve(answer);
    },
    /**
     * GET a secondary identity response.
     * @returns An empty success.
     */
    apiGet: (): Promise<Procedure<unknown>> => {
      const answer = succeed({});
      return Promise.resolve(answer);
    },
    /**
     * Query one GraphQL operation.
     * @param op - Operation label.
     * @returns The scenario's response.
     */
    apiQuery: (op: string): Promise<Procedure<unknown>> => {
      const answer = route(op);
      return Promise.resolve(answer);
    },
    /**
     * Accept a bearer token.
     * @returns True.
     */
    setBearer: (): boolean => true,
    /**
     * Accept a raw authorization header.
     * @returns True.
     */
    setRawAuth: (): boolean => true,
    /**
     * Accept session context.
     * @returns True.
     */
    setSessionContext: (): boolean => true,
    /**
     * Accept a token resolver.
     * @returns True.
     */
    withTokenResolver: (): boolean => true,
    /**
     * Accept a token strategy.
     * @returns True.
     */
    withTokenStrategy: (): boolean => true,
    /**
     * No session to prime.
     * @returns An empty token.
     */
    primeSession: (): Promise<Procedure<string>> => {
      const answer = succeed('');
      return Promise.resolve(answer);
    },
    ...makeRecoverySessionStubs(),
    /**
     * Return an empty session context.
     * @returns An empty record.
     */
    getSessionContext: (): Readonly<Record<string, unknown>> => ({}),
  } as unknown as IApiMediator;
  /**
   * Read the balance-call count.
   * @returns Number of balance operations seen.
   */
  const readBalanceCalls = (): number => balanceCalls;
  /**
   * Read the transaction-call count.
   * @returns Number of transaction operations seen.
   */
  const readTxnCalls = (): number => txnCalls;
  return { bus, balanceCalls: readBalanceCalls, txnCalls: readTxnCalls };
}

/**
 * Replace the shape's wire extractors with generic ones while keeping its
 * result guard and window policy.
 * @param shape - Real bank shape.
 * @param scenario - Failure class being injected.
 * @returns Instrumented shape.
 */
function instrument(
  shape: IApiDirectScrapeShape<unknown, unknown>,
  scenario: Scenario,
): IApiDirectScrapeShape<unknown, unknown> {
  let pageNo = 0;
  const isCeiling = scenario === 'pageCeiling';
  return {
    ...shape,
    bootstrap: undefined,
    responseSession: undefined,
    /** Synthetic account display number.
     * @returns A stable display number. */
    accountNumberOf: () => 'acct-1',
    /** Synthetic call account id.
     * @returns A stable id. */
    callAccountIdOf: () => 'acct-1',
    checkBody: undefined,
    checkBodyByOperation: undefined,
    customer: {
      ...shape.customer,
      urlTag: undefined,
      method: undefined,
      bodyTemplate: undefined,
      secondaryUrlTag: undefined,
      countDiscovered: undefined,
      /** Empty GraphQL variables.
       * @returns An empty record. */
      buildVars: () => ({}),
      /** One synthetic account.
       * @returns The account list. */
      extractAccounts: () => [ACCT],
    },
    balance: {
      ...shape.balance,
      urlTag: undefined,
      method: undefined,
      bodyTemplate: undefined,
      /** Empty GraphQL variables.
       * @returns An empty record. */
      buildVars: () => ({}),
      /** The synthetic body always carries a figure.
       * @returns False. */
      isAbsent: () => false,
      /** Synthetic balance.
       * @returns A stable number. */
      extract: () => 100,
    },
    transactions: {
      ...shape.transactions,
      urlTag: undefined,
      method: undefined,
      bodyTemplate: undefined,
      validatePlan: undefined,
      /** Empty GraphQL variables.
       * @returns An empty record. */
      buildVars: () => ({}),
      /** Stop predicate for the synthetic page.
       * @returns False during the ceiling walk. */
      stop: isCeiling ? (): boolean => false : shape.transactions.stop,
      /**
       * Return one synthetic page.
       * @returns A page with one mappable row and the next cursor.
       */
      extractPage: () => ({
        items: [ROW],
        nextCursor: isCeiling ? String(++pageNo) : false,
      }),
    },
  };
}

/** Context plus the balance-call reader for one scenario. */
interface IContextResult {
  readonly ctx: IPipelineContext;
  readonly balanceCalls: () => number;
  readonly txnCalls: () => number;
}

/**
 * Build a context for one scenario.
 * @param scenario - Failure class being injected.
 * @returns Context wired to the scenario's mediator.
 */
function contextOf(scenario: Scenario): IContextResult {
  const { bus, balanceCalls, txnCalls } = makeBus(scenario);
  const windowEnd = some(new Date('2026-02-01'));
  const ctx = makeMockContext({ apiMediator: some(bus), windowEnd });
  return { ctx, balanceCalls, txnCalls };
}

/** Counts of operations the mediator saw so far. */
interface ICallCounts {
  readonly balance: number;
  readonly txn: number;
}

/**
 * Read the current operation counts.
 * @param result - Context result carrying both counters.
 * @returns The balance and transaction counts.
 */
function countsOf(result: IContextResult): ICallCounts {
  return { balance: result.balanceCalls(), txn: result.txnCalls() };
}

/**
 * Reduce one phase result to its recorded verdict.
 * @param result - Phase result.
 * @param counts - Balance and transaction operations the mediator saw.
 * @returns Observed verdict.
 */
function verdictFrom(result: Procedure<IPipelineContext>, counts: ICallCounts): IVerdict {
  if (!result.success) {
    return {
      success: false,
      message: result.errorMessage,
      balanceCalls: counts.balance,
      txnCalls: counts.txn,
    };
  }
  const scrape = result.value.scrape;
  if (!scrape.has) {
    return { success: true, balanceCalls: counts.balance, txnCalls: counts.txn };
  }
  const account = scrape.value.accounts[0];
  const coverage = account.windowCoverage;
  return {
    success: true,
    txns: account.txns.length,
    coverage: coverage === undefined ? undefined : coverage.status,
    reason: coverage !== undefined && 'reason' in coverage ? coverage.reason : undefined,
    balanceCalls: counts.balance,
    txnCalls: counts.txn,
  };
}

/**
 * Run one shape through ACTION and POST.
 * @param shape - Instrumented shape.
 * @param scenario - Failure class being injected.
 * @returns Observed verdict.
 */
async function verdictOfShape(
  shape: IApiDirectScrapeShape<unknown, unknown>,
  scenario: Scenario,
): Promise<IVerdict> {
  const phase = buildApiDirectScrapePhase(shape);
  const context = contextOf(scenario);
  const action = await phase.action(context.ctx, context.ctx);
  const counts = countsOf(context);
  if (!action.success) return verdictFrom(action, counts);
  const input = { ...context.ctx, scrape: action.value.scrape };
  const post = await phase.post(context.ctx, input);
  const postCounts = countsOf(context);
  return verdictFrom(post, postCounts);
}

/**
 * Run one bank scenario and reduce the result to the verdict the table records.
 * @param row - Bank shape.
 * @param scenario - Failure class.
 * @returns Observed verdict.
 */
function verdictOf(row: IShapeRow, scenario: Scenario): Promise<IVerdict> {
  const shape = instrument(row.shape, scenario);
  return verdictOfShape(shape, scenario);
}

describe('cross-bank result policy characterization', () => {
  it.each(SHAPES)('$bank — balance 5xx follows its fallback policy', async row => {
    const verdict = await verdictOf(row, 'balance5xx');
    const isSkipped = SKIPPED_BANKS.has(row.bank);
    const hasFallback = isSkipped || BALANCE_FALLBACK_BANKS.has(row.bank);
    expect(row.shape.balance.skipFetch === true).toBe(isSkipped);
    expect(verdict.success).toBe(hasFallback);
    expect(verdict.balanceCalls).toBe(isSkipped ? 0 : 1);
    if (!hasFallback) expect(verdict.message).toBe('balance HTTP 500');
  });

  it.each(SHAPES)('$bank — a page ceiling succeeds with an unproven window', async row => {
    const verdict = await verdictOf(row, 'pageCeiling');
    expect(verdict.success).toBe(true);
    expect(verdict.txns).toBe(CEILING_TXNS[row.bank]);
    expect(verdict.coverage).toBe('unproven');
    expect(verdict.reason).toBe(CEILING_REASON[row.bank]);
  });

  it.each(SHAPES)('$bank — bank text is omitted from errorMessage', async row => {
    const verdict = await verdictOf(row, 'bankText');
    expect(verdict.success).toBe(false);
    expect(verdict.txnCalls).toBeGreaterThan(0);
    expect(verdict.message).not.toContain('BANK-TEXT-MARKER');
  });

  it('keeps bank text only for a shape that opts in', async () => {
    const optedIn = {
      ...instrument(PEPPER_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown>, 'bankText'),
      omitBankText: false,
    };
    const verdict = await verdictOfShape(optedIn, 'bankText');
    expect(verdict.success).toBe(false);
    expect(verdict.txnCalls).toBeGreaterThan(0);
    expect(verdict.message).toContain('BANK-TEXT-MARKER');
  });

  it('runs the shape resultGuard in POST and surfaces its failure', async () => {
    /**
     * Result guard that rejects every scrape.
     * @returns A typed guard failure.
     */
    const rejecting = (): Procedure<void> => fail(ScraperErrorTypes.Generic, 'guard rejected');
    const shape = {
      ...instrument(
        PEPPER_SHAPE as unknown as IApiDirectScrapeShape<unknown, unknown>,
        'balance5xx',
      ),
      resultGuard: rejecting,
    };
    const verdict = await verdictOfShape(shape, 'balance5xx');
    expect(verdict.success).toBe(false);
    expect(verdict.message).toBe('guard rejected');
  });
});
