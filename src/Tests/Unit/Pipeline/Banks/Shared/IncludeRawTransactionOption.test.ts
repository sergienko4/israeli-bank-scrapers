/**
 * Regression guard for issue #540 — `includeRawTransaction` on the Pipeline path.
 *
 * <p>The option is Legacy (deprecated): only the non-Pipeline scrapers read it,
 * and that decision is recorded in {@link ../../../../../../docs/architecture/legacy.md}.
 * This suite pins the resulting Pipeline behaviour so a future change cannot
 * quietly half-implement it — either the option keeps being ignored, or the
 * decision is revisited and this file is rewritten alongside the docs and
 * `LEGACY_ONLY_OPTIONS`.
 *
 * <p>Drives the real shared driver every Pipeline bank routes through
 * ({@link buildGenericHeadlessScrape}) with a synthetic shape, so the assertion
 * is about the driver's contract and not about any one bank. The control case
 * proves the harness reaches the mapper at all, which is what separates "the
 * option is ignored" from "the test never mapped a row".
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../../Scrapers/Base/Interface.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { buildGenericHeadlessScrape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeActions.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/Pagination.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction } from '../../../../../Transactions.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** Synthetic account ref — the minimum the shape needs. */
interface ISynAcct {
  readonly id: string;
  readonly num: string;
}

/**
 * The provider row. `providerOnlyField` has no WK alias, so on the legacy path
 * it could only reach a caller through `rawTransaction` — the debugging need
 * issue #540 states, and the field this suite proves the Pipeline drops.
 *
 * <p>The date sits after the mock context's start date on purpose: the driver
 * filters rows against `options.startDate`, so an earlier date would empty the
 * account and every assertion below would pass for the wrong reason.
 */
const PROVIDER_ROW = {
  date: '2026-07-15',
  amount: -42.5,
  description: 'Synthetic row',
  providerOnlyField: 'provider-only-value',
} as const;

/**
 * Return the display number for a synthetic account ref.
 * @param a - Account ref.
 * @returns Display number.
 */
function accountNumberOfSyn(a: ISynAcct): string {
  return a.num;
}

/**
 * Empty-vars helper — the customer query needs no variables.
 * @returns Empty record.
 */
function emptyVars(): Record<string, unknown> {
  return {};
}

/**
 * Extract synthetic accounts from the customer response.
 * @param args - Extract-args bundle.
 * @param args.body - Hydrated response body.
 * @returns Synthetic account list.
 */
function extractAccountsSyn(args: { readonly body: Record<string, unknown> }): readonly ISynAcct[] {
  return (args.body as { accts: readonly ISynAcct[] }).accts;
}

/**
 * Extract the synthetic balance value.
 * @param body - Balance response body.
 * @returns Balance value.
 */
function balExtractSyn(body: Record<string, unknown>): number {
  return (body as { balance: number }).balance;
}

/**
 * Build per-account variables (shared by the balance and txn queries).
 * @param a - Account ref.
 * @returns Variables map.
 */
function varsSyn(a: ISynAcct): Record<string, unknown> {
  return { id: a.id };
}

/**
 * Extract a synthetic page — the body is already shaped as an IPage.
 * @param args - Extract-args bundle.
 * @param args.body - Hydrated response body.
 * @returns Generic page.
 */
function extractPageSyn(args: { readonly body: Record<string, unknown> }): IPage<object, string> {
  return args.body as unknown as IPage<object, string>;
}

/**
 * Build the synthetic scrape shape.
 * @returns Scrape shape with a string cursor.
 */
function makeShape(): IApiDirectScrapeShape<ISynAcct, string> {
  return {
    stepName: 'RawTxnProof',
    accountNumberOf: accountNumberOfSyn,
    customer: { buildVars: emptyVars, extractAccounts: extractAccountsSyn },
    balance: { buildVars: varsSyn, extract: balExtractSyn },
    transactions: {
      buildVars: varsSyn,
      extractPage: extractPageSyn,
      // The synthetic provider exposes no upper bound to narrow, so a coverage
      // gap could only be reported. Keeps this proof off the backfill path.
      windowNarrowing: 'lowerBoundOnly',
    },
  };
}

/**
 * Build a router-backed mock mediator that serves one scripted response per op.
 * @returns Mock mediator.
 */
function makeRouterBus(): IApiMediator {
  const queues: Record<string, Procedure<unknown>[]> = {
    customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
    balance: [succeed({ balance: 42 })],
    transactions: [succeed({ items: [PROVIDER_ROW], nextCursor: false })],
  };
  return busOf(queues);
}

/**
 * Wrap scripted queues in the mediator surface the driver consumes.
 * @param queues - Per-op ordered response queues.
 * @returns Mock mediator.
 */
function busOf(queues: Record<string, Procedure<unknown>[]>): IApiMediator {
  /**
   * Shift the queue for one operation.
   * @param op - Operation label.
   * @returns Next queued procedure.
   */
  async function route(op: string): Promise<Procedure<unknown>> {
    await Promise.resolve();
    const queue = queues[op] ?? [];
    const head = queue.shift();
    if (head) return head;
    return fail(ScraperErrorTypes.Generic, `no stub for op=${op}`);
  }
  return {
    apiPost: jest.fn(),
    apiGet: jest.fn(),
    apiQuery: jest.fn(route),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => ({})),
  } as unknown as IApiMediator;
}

/**
 * Build an action context carrying the caller-supplied option value.
 * @param bus - Mock mediator.
 * @param includeRawTransaction - The option under test.
 * @returns Action context.
 */
function ctxWithOption(bus: IApiMediator, includeRawTransaction: boolean): IActionContext {
  const base = makeMockContext();
  const options: ScraperOptions = { ...base.options, includeRawTransaction };
  const withBus: IPipelineContext = { ...base, options, apiMediator: some(bus) };
  return { ...withBus, windowEnd: none() } as unknown as IActionContext;
}

/**
 * Run the real driver end to end and return the single mapped transaction.
 * @param includeRawTransaction - The option value to scrape under.
 * @returns The one transaction the synthetic page produced.
 */
async function scrapeOneTxn(includeRawTransaction: boolean): Promise<ITransaction> {
  const shape = makeShape();
  const scrape = buildGenericHeadlessScrape(shape);
  const bus = makeRouterBus();
  const ctx = ctxWithOption(bus, includeRawTransaction);
  const result = await scrape(ctx);
  assertOk(result);
  const scr = result.value.scrape;
  assertHas(scr);
  return scr.value.accounts[0].txns[0];
}

describe('ScraperOptions.includeRawTransaction on the Pipeline path', () => {
  it('maps the row, proving the harness reaches the mapper', async () => {
    const txn = await scrapeOneTxn(false);
    expect(txn.description).toBe('Synthetic row');
    expect(txn.chargedAmount).toBe(-42.5);
  });

  it('omits the provider row when the caller leaves the option off', async () => {
    const txn = await scrapeOneTxn(false);
    expect(txn.rawTransaction).toBeUndefined();
  });

  it('still omits it when the caller opts in, because the option is legacy-only', async () => {
    const txn = await scrapeOneTxn(true);
    expect(txn.rawTransaction).toBeUndefined();
  });

  it('drops provider-only fields, which is what the construction-time warning names', async () => {
    const txn = await scrapeOneTxn(true);
    const carried = Object.values(txn as unknown as Record<string, unknown>);
    expect(carried).not.toContain('provider-only-value');
  });
});
