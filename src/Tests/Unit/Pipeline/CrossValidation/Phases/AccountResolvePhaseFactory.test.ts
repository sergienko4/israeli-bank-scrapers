/**
 * Phase H+ - cross-bank ACCOUNT-RESOLVE per-phase factory (DEEP).
 *
 * <p>Honors the locked plan factory-depth expectation: drives
 * PRE -> ACTION -> POST -> FINAL chain per bank through real
 * production code paths.
 *
 * <ul>
 *   <li>PRE: {@link executeAccountResolvePre} - awaits late-
 *     arriving id captures via mediator.network.waitForFirstId.</li>
 *   <li>ACTION: {@link executeAccountResolveAction} - sealed
 *     pass-through (no mediator on action context).</li>
 *   <li>POST: {@link executeAccountResolvePost} - reads pre-nav
 *     pool, runs discoverAccountsInPool, commits
 *     ctx.accountDiscovery.</li>
 *   <li>FINAL: {@link executeAccountResolveFinal} - telemetry
 *     stamping; always succeeds.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers + the
 * shared {@link unwrapOrThrow} from `_deepPhaseHelpers.ts`.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeAccountResolveAction,
  executeAccountResolveFinal,
  executeAccountResolvePost,
  executeAccountResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockActionExecutor, toActionCtx } from '../../Infrastructure/TestHelpers.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import { mergeActionDiagnostics, unwrapOrThrow } from './Fixtures/_deepPhaseHelpers.js';
import {
  buildAccountResolvePhaseContext,
  type IAccountResolvePhaseTestSubject,
} from './Fixtures/_makeAccountResolvePhaseContext.js';
import { type IPhaseHFixture, loadPhaseFixture } from './Fixtures/_makePhaseFixture.js';

/** Bundle returned by {@link prepareAccountResolveRow}. */
interface IAccountResolveRowSetup {
  readonly row: IBankScenario;
  readonly fixture: IPhaseHFixture;
  readonly subject: IAccountResolvePhaseTestSubject;
}

/**
 * Type guard for the fixture-meta block carrying
 * `accountsResponseBody`. Replaces the previous double-cast (rabbit
 * cycle #2 finding kept open; double-cast also forbidden by
 * `eslint.config.mjs §8a` A2 rule).
 *
 * @param meta - Fixture meta value (typed as `unknown`).
 * @returns True when `meta` is an object carrying a defined
 *   `accountsResponseBody` property.
 */
function hasAccountsResponseBody(
  meta: unknown,
): meta is { readonly accountsResponseBody: unknown } {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'accountsResponseBody' in meta &&
    (meta as { accountsResponseBody?: unknown }).accountsResponseBody !== undefined
  );
}

/**
 * Read the redacted accounts response body from the fixture meta,
 * failing fast when absent (no silent bypass).
 *
 * @param fixture - Loaded ACCOUNT-RESOLVE fixture.
 * @returns Redacted accounts response body.
 */
function readAccountsResponseBody(fixture: IPhaseHFixture): unknown {
  if (!hasAccountsResponseBody(fixture.meta)) {
    throw new ScraperError(`ACCOUNT_RESOLVE_FIXTURE_MISSING_BODY bank=${fixture.meta.bank}`);
  }
  return fixture.meta.accountsResponseBody;
}

/**
 * Build the deep ACCOUNT-RESOLVE test subject from the shared bank
 * scenario + fixture meta.
 *
 * @param row - Per-bank scenario row.
 * @returns Row + fixture + subject bundle.
 */
function prepareAccountResolveRow(row: IBankScenario): IAccountResolveRowSetup {
  const fixture = loadPhaseFixture(row.bank, 'account-resolve/last-good');
  const responseBody = readAccountsResponseBody(fixture);
  const subject = buildAccountResolvePhaseContext({
    poolUrl: row.accountsUrl,
    responseBody,
  });
  return { row, fixture, subject };
}

/**
 * Drive ACCOUNT-RESOLVE.PRE via production executeAccountResolvePre.
 *
 * @param setup - Row + subject bundle.
 * @returns PRE-updated pipeline context.
 */
async function runAccountResolvePre(setup: IAccountResolveRowSetup): Promise<IPipelineContext> {
  const result = await executeAccountResolvePre(setup.subject.context);
  return unwrapOrThrow(result, `ACCOUNT_RESOLVE_PRE_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive ACCOUNT-RESOLVE.ACTION (sealed pass-through).
 *
 * @param setup - Row + subject bundle.
 * @param preCtx - PRE-updated context.
 * @returns Action context pass-through.
 */
async function runAccountResolveAction(
  setup: IAccountResolveRowSetup,
  preCtx: IPipelineContext,
): Promise<IActionContext> {
  const executor = makeMockActionExecutor();
  const actionCtx = toActionCtx(preCtx, executor);
  const result = await executeAccountResolveAction(actionCtx);
  return unwrapOrThrow(result, `ACCOUNT_RESOLVE_ACTION_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive ACCOUNT-RESOLVE.POST via production executeAccountResolvePost.
 *
 * @param setup - Row + subject bundle.
 * @param preCtx - PRE-updated context.
 * @returns POST-updated pipeline context.
 */
async function runAccountResolvePost(
  setup: IAccountResolveRowSetup,
  preCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeAccountResolvePost(preCtx);
  return unwrapOrThrow(result, `ACCOUNT_RESOLVE_POST_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive ACCOUNT-RESOLVE.FINAL via production
 * executeAccountResolveFinal.
 *
 * @param setup - Row + subject bundle.
 * @param postCtx - POST-updated context.
 * @returns FINAL-updated pipeline context.
 */
async function runAccountResolveFinal(
  setup: IAccountResolveRowSetup,
  postCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeAccountResolveFinal(postCtx);
  return unwrapOrThrow(result, `ACCOUNT_RESOLVE_FINAL_FAILED bank=${setup.row.bank}`);
}

/**
 * Run the full ACCOUNT-RESOLVE PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + subject bundle.
 * @returns FINAL pipeline context.
 */
async function runAccountResolveChain(setup: IAccountResolveRowSetup): Promise<IPipelineContext> {
  const preCtx = await runAccountResolvePre(setup);
  const actionCtx = await runAccountResolveAction(setup, preCtx);
  const postInput = mergeActionDiagnostics(preCtx, actionCtx);
  const postCtx = await runAccountResolvePost(setup, postInput);
  return runAccountResolveFinal(setup, postCtx);
}

/**
 * Assert ctx.accountDiscovery committed with expected id count.
 *
 * @param setup - Row + subject + fixture bundle.
 * @param finalCtx - Context after the full chain.
 * @returns True after assertions.
 */
function assertAccountResolveShape(
  setup: IAccountResolveRowSetup,
  finalCtx: IPipelineContext,
): boolean {
  expect(finalCtx.accountDiscovery.has).toBe(true);
  if (!finalCtx.accountDiscovery.has) return true;
  const expectedCount = setup.fixture.meta.expected.accountResolveExpectedIdCount ?? 1;
  expect(finalCtx.accountDiscovery.value.ids.length).toBe(expectedCount);
  return true;
}

describe('ACCOUNT-RESOLVE-PHASE-FACTORY - DEEP cross-bank PRE-ACTION-POST-FINAL', () => {
  it.each(BANK_SCENARIOS)('accountResolve_$bank_ShouldCompleteFullChain', async row => {
    const setup = prepareAccountResolveRow(row);
    const finalCtx = await runAccountResolveChain(setup);
    expect(finalCtx.accountDiscovery.has).toBe(true);
    assertAccountResolveShape(setup, finalCtx);
  });
});
