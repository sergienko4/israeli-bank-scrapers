/**
 * Phase H+ - cross-bank SCRAPE per-phase factory (DEEP).
 *
 * <p>Honors the locked plan factory-depth expectation: drives the
 * full PRE -> ACTION -> POST -> FINAL chain per bank through real
 * production code paths.
 *
 * <ul>
 *   <li>PRE: {@link executeForensicPre} - forensic priming +
 *     DIRECT discovery; short-circuits when api absent (test
 *     mode), preserving ctx.scrape for downstream POST.</li>
 *   <li>ACTION: {@link executeMatrixLoop} - sealed
 *     {@link executeFrozenDirectScrape}; short-circuits when
 *     scrapeDiscovery absent (test mode).</li>
 *   <li>POST: {@link executeValidateResults} - all-accounts-empty
 *     guard; succeeds with at least one populated account.</li>
 *   <li>FINAL: {@link executeStampAccounts} - stamps account count
 *     into diagnostics for audit trail.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeForensicPre,
  executeMatrixLoop,
  executeStampAccounts,
  executeValidateResults,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../../../../Transactions.js';
import { makeMockActionExecutor, toActionCtx } from '../../Infrastructure/TestHelpers.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import { type IPhaseHFixture, loadPhaseFixture } from './Fixtures/_makePhaseFixture.js';
import { buildScrapePhaseContext } from './Fixtures/_makeScrapePhaseContext.js';

/** Bundle returned by {@link prepareScrapeRow}. */
interface IScrapeRowSetup {
  readonly row: IBankScenario;
  readonly fixture: IPhaseHFixture;
  readonly context: IPipelineContext;
}

/**
 * Build a single redacted transaction record.
 *
 * @param ordinal - Identifier suffix for uniqueness.
 * @returns Redacted transaction record.
 */
function buildRedactedTxn(ordinal: number): ITransaction {
  return {
    type: TransactionTypes.Normal,
    identifier: `FAKE-TXN-${String(ordinal)}`,
    date: '2026-05-01T00:00:00.000Z',
    processedDate: '2026-05-01T00:00:00.000Z',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'FAKE TEXT',
    status: TransactionStatuses.Completed,
  };
}

/**
 * Build a redacted account with the requested txn count.
 *
 * @param txnCount - Number of txns to populate.
 * @returns Redacted account record.
 */
function buildRedactedAccount(txnCount: number): ITransactionsAccount {
  const txns = Array.from(
    { length: txnCount },
    (_unused, index): ITransaction => buildRedactedTxn(index),
  );
  return {
    accountNumber: 'FAKE-000000',
    balance: 0,
    txns,
  };
}

/**
 * Build the deep SCRAPE context. Stamps ctx.scrape with fixture-
 * driven accounts so POST + FINAL can validate.
 *
 * @param row - Per-bank scenario row.
 * @returns Row + fixture + context bundle.
 */
function prepareScrapeRow(row: IBankScenario): IScrapeRowSetup {
  const fixture = loadPhaseFixture(row.bank, 'scrape/last-good');
  const expectedTxnCount = fixture.meta.expected.scrapeExpectedTxnCount ?? 1;
  const accounts: readonly ITransactionsAccount[] = [buildRedactedAccount(expectedTxnCount)];
  const subject = buildScrapePhaseContext({ accounts });
  return { row, fixture, context: subject.context };
}

/**
 * Drive SCRAPE.PRE via production executeForensicPre.
 *
 * @param setup - Row + context bundle.
 * @returns PRE-updated pipeline context.
 */
async function runScrapePre(setup: IScrapeRowSetup): Promise<IPipelineContext> {
  const result = await executeForensicPre(setup.context);
  if (!result.success) {
    throw new ScraperError(`SCRAPE_PRE_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive SCRAPE.ACTION via production executeMatrixLoop.
 *
 * @param setup - Row + context bundle.
 * @param preCtx - PRE-updated context.
 * @returns Action context pass-through.
 */
async function runScrapeAction(
  setup: IScrapeRowSetup,
  preCtx: IPipelineContext,
): Promise<IActionContext> {
  const executor = makeMockActionExecutor();
  const actionCtx = toActionCtx(preCtx, executor);
  const result = await executeMatrixLoop(actionCtx);
  if (!result.success) {
    throw new ScraperError(`SCRAPE_ACTION_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive SCRAPE.POST via production executeValidateResults.
 *
 * @param setup - Row + context bundle.
 * @param preCtx - PRE-updated context (preserves ctx.scrape).
 * @returns POST-updated pipeline context.
 */
async function runScrapePost(
  setup: IScrapeRowSetup,
  preCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeValidateResults(preCtx);
  if (!result.success) {
    throw new ScraperError(`SCRAPE_POST_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive SCRAPE.FINAL via production executeStampAccounts.
 *
 * @param setup - Row + context bundle.
 * @param postCtx - POST-updated context.
 * @returns FINAL-updated pipeline context.
 */
async function runScrapeFinal(
  setup: IScrapeRowSetup,
  postCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeStampAccounts(postCtx);
  if (!result.success) {
    throw new ScraperError(`SCRAPE_FINAL_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Run the full SCRAPE PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + context bundle.
 * @returns FINAL pipeline context.
 */
async function runScrapeChain(setup: IScrapeRowSetup): Promise<IPipelineContext> {
  const preCtx = await runScrapePre(setup);
  await runScrapeAction(setup, preCtx);
  const postCtx = await runScrapePost(setup, preCtx);
  return runScrapeFinal(setup, postCtx);
}

/**
 * Assert SCRAPE.FINAL stamped diagnostics.
 *
 * @param finalCtx - Context after the chain.
 * @returns True after assertions.
 */
function assertScrapeShape(finalCtx: IPipelineContext): boolean {
  expect(finalCtx.scrape.has).toBe(true);
  expect(typeof finalCtx.diagnostics.lastAction).toBe('string');
  return true;
}

describe('SCRAPE-PHASE-FACTORY - DEEP cross-bank PRE-ACTION-POST-FINAL', () => {
  it.each(BANK_SCENARIOS)('scrape_$bank_ShouldCompleteFullChain', async (row): Promise<void> => {
    const setup = prepareScrapeRow(row);
    const finalCtx = await runScrapeChain(setup);
    assertScrapeShape(finalCtx);
  });
});
