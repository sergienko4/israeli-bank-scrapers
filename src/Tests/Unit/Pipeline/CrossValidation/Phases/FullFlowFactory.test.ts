/**
 * Phase H.T4 — cross-bank FULL-FLOW factory.
 *
 * <p>Chains every PHASE_H_BANK through all 10 pipeline phases by
 * replaying each phase's per-phase factory against the bank's
 * per-phase last-good fixture. Asserts the bank's last-good
 * captured-shape data flows end-to-end through:
 *
 * <ol>
 *   <li>INIT.POST (executeValidatePage)</li>
 *   <li>HOME.POST (executeValidateLoginArea)</li>
 *   <li>PRE-LOGIN.POST + FINAL (executeValidateForm + executeSignalToLogin)</li>
 *   <li>LOGIN.FINAL (executeLoginSignal cookie audit)</li>
 *   <li>OTP-TRIGGER.POST + FINAL (only for OTP-using banks)</li>
 *   <li>OTP-FILL.POST + FINAL (only for OTP-using banks)</li>
 *   <li>AUTH-DISCOVERY.POST (executeAuthDiscoveryPost)</li>
 *   <li>ACCOUNT-RESOLVE.POST + FINAL</li>
 *   <li>SCRAPE.POST + FINAL</li>
 *   <li>TERMINATE.PRE + POST + FINAL</li>
 * </ol>
 *
 * <p>Each phase consumes its OWN fixture (the per-phase factories'
 * fixtures from H.T3c.1..10) — H.T4 is the topological chain, not a
 * new fixture format. Per-phase POST helpers take both `row` (for
 * bank routing) and the freshly-built per-phase preCtx so the
 * factory mirrors production context handoff
 * (`PostUsesActionContext` canary).
 *
 * <p>Production action imports route through
 * {@link _FullFlowActions} and per-phase builders through
 * {@link _PhaseContextBuilders} so this file stays under the
 * project's `import-x/max-dependencies` ceiling.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { type ITransaction, type ITransactionsAccount } from '../../../../../Transactions.js';
import {
  BANK_SCENARIOS,
  FAKE_ACCOUNT_NUMBER,
  type IBankScenario,
  REDACTED_PHONE_HINT,
} from './Fixtures/_BankScenarios.js';
import { buildRedactedTxn as buildRedactedTxnBase } from './Fixtures/_deepPhaseHelpers.js';
import {
  executeAccountResolveFinal,
  executeAccountResolvePost,
  executeAuthDiscoveryPost,
  executeFillFinal,
  executeFillPost,
  executeLoginSignal,
  executeLogResults,
  executeSignalDone,
  executeSignalToLogin,
  executeStampAccounts,
  executeStartCleanup,
  executeTriggerFinal,
  executeTriggerPost,
  executeValidateForm,
  executeValidateLoginArea,
  executeValidatePage,
  executeValidateResults,
} from './Fixtures/_FullFlowActions.js';
import {
  buildAccountResolvePhaseContext,
  buildHomePhaseContext,
  buildInitPhaseContext,
  buildLoginPhaseContext,
  buildOtpFillPhaseContext,
  buildOtpTriggerPhaseContext,
  buildPreLoginPhaseContext,
  buildScrapePhaseContext,
  buildTerminatePhaseContext,
  loadAuthDiscoveryFixtureCookies,
  loadLoginFixtureCookies,
  loadPhaseFixture,
} from './Fixtures/_PhaseContextBuilders.js';

/** Per-bank full-flow row — aliased to the shared scenario type. */
type IFullFlowRow = IBankScenario;

/** Scenarios — one row per PHASE_H_BANK from shared {@link BANK_SCENARIOS}. */
const SCENARIOS: readonly IFullFlowRow[] = BANK_SCENARIOS;

/**
 * Type guard for the fixture-meta block carrying
 * `accountsResponseBody`. Replaces the previous double-cast (rabbit
 * cycle #3 finding #3 + `eslint.config.mjs §8a` A2 ban).
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
 * Read the redacted accounts payload from an ACCOUNT-RESOLVE
 * fixture. Fails fast with a fixture-path-tagged
 * {@link ScraperError} when the payload is missing — bypass-casting
 * `as unknown as` silently allowed the test to run against an
 * empty pool and assert success against the wrong shape (CodeRabbit
 * 2026-05-16 finding #24 + cycle #3 finding #3).
 *
 * @param fixture - Loaded ACCOUNT-RESOLVE fixture.
 * @returns Redacted accounts response body.
 * @throws {ScraperError} When the fixture lacks accountsResponseBody.
 */
function readAccountsResponseBody(fixture: ReturnType<typeof loadPhaseFixture>): unknown {
  if (!hasAccountsResponseBody(fixture.meta)) {
    throw new ScraperError(
      `FULL_FLOW_FIXTURE_MISSING_ACCOUNTS_BODY: bank=${fixture.meta.bank} scenario=${fixture.meta.scenarioId}`,
    );
  }
  return fixture.meta.accountsResponseBody;
}

/**
 * Build a single redacted txn for the SCRAPE leg of the full-flow.
 *
 * @param ordinal - Identifier suffix so multi-txn rows stay distinct.
 * @returns Redacted transaction record.
 */
function buildFlowTxn(ordinal: number): ITransaction {
  return buildRedactedTxnBase('FAKE-FLOW', ordinal);
}

/**
 * Build the INIT per-phase preCtx for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns Pre-built pipeline context for INIT.POST.
 */
function buildInitPreCtx(row: IFullFlowRow): IPipelineContext {
  return buildInitPhaseContext({ initPostUrl: row.postNavUrl }).context;
}

/**
 * Run INIT.POST for one bank row against the supplied preCtx.
 *
 * @param _row - Per-bank scenario row (kept for symmetry; unused).
 * @param preCtx - INIT preCtx from {@link buildInitPreCtx}.
 * @returns True when INIT.POST succeeds.
 */
async function runInitPost(_row: IFullFlowRow, preCtx: IPipelineContext): Promise<boolean> {
  const initResult = await executeValidatePage(preCtx);
  return initResult.success;
}

/**
 * Build the HOME per-phase preCtx + homepage URL for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns Pre-built HOME phase subject (context + homepageUrl).
 */
function buildHomePreCtx(row: IFullFlowRow): ReturnType<typeof buildHomePhaseContext> {
  return buildHomePhaseContext({
    homepageUrl: row.homepageUrl,
    postNavUrl: row.postNavUrl,
    frameCount: row.frameCount,
  });
}

/**
 * Run HOME.POST for one bank row against the supplied preCtx.
 *
 * @param _row - Per-bank scenario row (kept for symmetry; unused).
 * @param preCtx - HOME phase subject from {@link buildHomePreCtx}.
 * @returns True when HOME.POST succeeds.
 */
async function runHomePost(
  _row: IFullFlowRow,
  preCtx: ReturnType<typeof buildHomePhaseContext>,
): Promise<boolean> {
  if (!preCtx.context.mediator.has) return false;
  const args = buildHomeArgs({ preCtx, mediator: preCtx.context.mediator.value });
  return (await executeValidateLoginArea(args)).success;
}

/** Args bundle accepted by {@link executeValidateLoginArea}. */
type LoginAreaArgs = Parameters<typeof executeValidateLoginArea>[0];

/** Inputs needed to build the FullFlow HOME args bundle. */
interface IBuildHomeArgsInput {
  readonly preCtx: ReturnType<typeof buildHomePhaseContext>;
  readonly mediator: IElementMediator;
}

/**
 * Build the {@link executeValidateLoginArea} argument bundle from
 * the HOME per-phase subject.
 *
 * @param input - HOME phase subject + narrowed mediator.
 * @returns Args bundle for HOME.POST.
 */
function buildHomeArgs(input: IBuildHomeArgsInput): LoginAreaArgs {
  return {
    mediator: input.mediator,
    input: input.preCtx.context,
    homepageUrl: input.preCtx.homepageUrl,
    logger: input.preCtx.context.logger,
  };
}

/**
 * Run INIT.POST followed by HOME.POST.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both phases succeed.
 */
async function runInitHome(row: IFullFlowRow): Promise<boolean> {
  const initPreCtx = buildInitPreCtx(row);
  const isInitOk = await runInitPost(row, initPreCtx);
  if (!isInitOk) return false;
  const homePreCtx = buildHomePreCtx(row);
  return runHomePost(row, homePreCtx);
}

/**
 * Run PRE-LOGIN.POST + PRE-LOGIN.FINAL for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both PRE-LOGIN sub-steps succeed.
 */
async function runPreLogin(row: IFullFlowRow): Promise<boolean> {
  const subject = buildPreLoginPhaseContext({ isFormGateFound: true, loginUrl: row.loginUrl });
  if (!subject.context.mediator.has) return false;
  const post = await executeValidateForm(subject.context.mediator.value, subject.context);
  if (!post.success) return false;
  return executeSignalToLogin(post.value).success;
}

/**
 * Run LOGIN.FINAL cookie audit for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when LOGIN.FINAL succeeds.
 */
async function runLoginFinal(row: IFullFlowRow): Promise<boolean> {
  const loginFixture = loadPhaseFixture(row.bank, 'login/last-good');
  const loginCookies = loadLoginFixtureCookies(row.bank, 'last-good');
  const loginCtx = buildLoginPhaseContext(loginFixture, loginCookies);
  const loginFinal = await executeLoginSignal(loginCtx);
  return loginFinal.success;
}

/**
 * Run PRE-LOGIN POST+FINAL followed by LOGIN.FINAL.
 *
 * @param row - Per-bank scenario row.
 * @returns True when the full PRE-LOGIN → LOGIN.FINAL leg succeeds.
 */
async function runPreLoginAndLogin(row: IFullFlowRow): Promise<boolean> {
  const isPreLoginOk = await runPreLogin(row);
  if (!isPreLoginOk) return false;
  return runLoginFinal(row);
}

/**
 * Run OTP-TRIGGER POST+FINAL for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both OTP-TRIGGER sub-steps succeed.
 */
async function runOtpTrigger(row: IFullFlowRow): Promise<boolean> {
  const subject = buildOtpTriggerPhaseContext({
    phoneHint: REDACTED_PHONE_HINT,
    otpUrl: `${row.loginUrl}/otp`,
  });
  const post = await executeTriggerPost(subject.context);
  if (!post.success) return false;
  return (await executeTriggerFinal(post.value)).success;
}

/**
 * Run OTP-FILL POST+FINAL for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both OTP-FILL sub-steps succeed.
 */
async function runOtpFill(row: IFullFlowRow): Promise<boolean> {
  const subject = buildOtpFillPhaseContext({
    cookieCount: row.cookieCount,
    dashboardUrl: row.dashboardUrl,
  });
  const post = await executeFillPost(subject.context);
  if (!post.success) return false;
  return (await executeFillFinal(post.value)).success;
}

/**
 * Run the OTP-TRIGGER + OTP-FILL legs (only for OTP banks).
 *
 * @param row - Per-bank scenario row.
 * @returns True when both OTP phases succeed end-to-end.
 */
async function runOtpLeg(row: IFullFlowRow): Promise<boolean> {
  const isTriggerOk = await runOtpTrigger(row);
  if (!isTriggerOk) return false;
  return runOtpFill(row);
}

/**
 * Build the AUTH-DISCOVERY per-phase preCtx for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns Pre-built pipeline context for AUTH-DISCOVERY.POST.
 */
function buildAuthDiscoveryPreCtx(row: IFullFlowRow): IPipelineContext {
  const authFixture = loadPhaseFixture(row.bank, 'auth-discovery/last-good');
  const authCookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  return buildLoginPhaseContext(authFixture, authCookies);
}

/**
 * Run AUTH-DISCOVERY.POST for one row against the supplied preCtx.
 *
 * @param _row - Per-bank scenario row (kept for symmetry; unused).
 * @param preCtx - AUTH-DISCOVERY preCtx from {@link buildAuthDiscoveryPreCtx}.
 * @returns True when AUTH-DISCOVERY.POST succeeds.
 */
async function runAuthDiscoveryPost(
  _row: IFullFlowRow,
  preCtx: IPipelineContext,
): Promise<boolean> {
  const authResult = await executeAuthDiscoveryPost(preCtx);
  return authResult.success;
}

/**
 * Run ACCOUNT-RESOLVE POST+FINAL for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both ACCOUNT-RESOLVE sub-steps succeed.
 */
async function runAccountResolve(row: IFullFlowRow): Promise<boolean> {
  const acctFixture = loadPhaseFixture(row.bank, 'account-resolve/last-good');
  const responseBody = readAccountsResponseBody(acctFixture);
  const subject = buildAccountResolvePhaseContext({ poolUrl: row.accountsUrl, responseBody });
  const post = await executeAccountResolvePost(subject.context);
  if (!post.success) return false;
  return (await executeAccountResolveFinal(post.value)).success;
}

/**
 * Run SCRAPE POST+FINAL with a single redacted txn for one row.
 *
 * @returns True when both SCRAPE sub-steps succeed.
 */
async function runScrape(): Promise<boolean> {
  const accounts: readonly ITransactionsAccount[] = [
    { accountNumber: FAKE_ACCOUNT_NUMBER, balance: 0, txns: [buildFlowTxn(0)] },
  ];
  const scrapeSubject = buildScrapePhaseContext({ accounts });
  const scrapePost = await executeValidateResults(scrapeSubject.context);
  if (!scrapePost.success) return false;
  return (await executeStampAccounts(scrapePost.value)).success;
}

/**
 * Run TERMINATE PRE+POST+FINAL for one row.
 *
 * @returns True when all three TERMINATE sub-steps succeed.
 */
async function runTerminateTail(): Promise<boolean> {
  const subject = buildTerminatePhaseContext();
  const pre = await executeStartCleanup(subject.context);
  if (!pre.success) return false;
  const post = await executeLogResults(pre.value);
  if (!post.success) return false;
  return (await executeSignalDone(post.value)).success;
}

/**
 * Run the AUTH-DISCOVERY → ACCOUNT-RESOLVE → SCRAPE → TERMINATE
 * back-half legs.
 *
 * @param row - Per-bank scenario row.
 * @returns True when every back-half phase succeeds.
 */
async function runBackHalf(row: IFullFlowRow): Promise<boolean> {
  const authPreCtx = buildAuthDiscoveryPreCtx(row);
  const isAuthOk = await runAuthDiscoveryPost(row, authPreCtx);
  if (!isAuthOk) return false;
  const isAcctOk = await runAccountResolve(row);
  if (!isAcctOk) return false;
  const isScrapeOk = await runScrape();
  if (!isScrapeOk) return false;
  return runTerminateTail();
}

/**
 * Run the full 10-phase chain for one bank row, asserting at each
 * leg.
 *
 * @param row - Per-bank scenario row.
 * @returns Resolved when all leg assertions complete.
 */
async function runFullFlowForRow(row: IFullFlowRow): Promise<void> {
  expect(await runInitHome(row)).toBe(true);
  expect(await runPreLoginAndLogin(row)).toBe(true);
  if (row.usesOtp) expect(await runOtpLeg(row)).toBe(true);
  expect(await runBackHalf(row)).toBe(true);
}

describe('FULL-FLOW-FACTORY — Phase H per-bank 10-phase chain', () => {
  it.each(SCENARIOS)('fullFlow_$bank_lastGood_ShouldCompleteEveryPhase', async row => {
    expect(row.bank).toBeDefined();
    await runFullFlowForRow(row);
  });
});
