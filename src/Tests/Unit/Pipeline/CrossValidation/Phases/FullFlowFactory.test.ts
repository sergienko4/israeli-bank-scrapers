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
 * new fixture format. A regression in any phase's wiring surfaces
 * as a failing full-flow row even if the per-phase factory passes.
 *
 * <p>Production action imports route through
 * {@link _FullFlowActions} and per-phase builders through
 * {@link _PhaseContextBuilders} so this file stays under the
 * project's `import-x/max-dependencies` ceiling.
 */

import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../../../../Transactions.js';
import {
  BANK_SCENARIOS,
  FAKE_ACCOUNT_NUMBER,
  type IBankScenario,
  REDACTED_PHONE_HINT,
} from './Fixtures/_BankScenarios.js';
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
 * Build a single redacted txn for the SCRAPE leg of the full-flow.
 *
 * @param ordinal - Identifier suffix so multi-txn rows stay distinct.
 * @returns Redacted transaction record.
 */
function buildFlowTxn(ordinal: number): ITransaction {
  return {
    type: TransactionTypes.Normal,
    identifier: `FAKE-FLOW-${String(ordinal)}`,
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
 * Run INIT.POST for one bank row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when INIT.POST succeeds.
 */
async function runInitPost(row: IFullFlowRow): Promise<boolean> {
  const initSubject = buildInitPhaseContext({ initPostUrl: row.postNavUrl });
  const initResult = await executeValidatePage(initSubject.context);
  return initResult.success;
}

/**
 * Run HOME.POST for one bank row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when HOME.POST succeeds.
 */
async function runHomePost(row: IFullFlowRow): Promise<boolean> {
  const homeSubject = buildHomePhaseContext({
    homepageUrl: row.homepageUrl,
    postNavUrl: row.postNavUrl,
    frameCount: row.frameCount,
  });
  if (!homeSubject.context.mediator.has) return false;
  const homeResult = await executeValidateLoginArea({
    mediator: homeSubject.context.mediator.value,
    input: homeSubject.context,
    homepageUrl: homeSubject.homepageUrl,
    logger: homeSubject.context.logger,
  });
  return homeResult.success;
}

/**
 * Run INIT.POST followed by HOME.POST.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both phases succeed.
 */
async function runInitHome(row: IFullFlowRow): Promise<boolean> {
  const isInitOk = await runInitPost(row);
  if (!isInitOk) return false;
  return runHomePost(row);
}

/**
 * Run PRE-LOGIN.POST + PRE-LOGIN.FINAL for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both PRE-LOGIN sub-steps succeed.
 */
async function runPreLogin(row: IFullFlowRow): Promise<boolean> {
  const preLoginSubject = buildPreLoginPhaseContext({
    isFormGateFound: true,
    loginUrl: row.loginUrl,
  });
  if (!preLoginSubject.context.mediator.has) return false;
  const preLoginPost = await executeValidateForm(
    preLoginSubject.context.mediator.value,
    preLoginSubject.context,
  );
  if (!preLoginPost.success) return false;
  const preLoginFinal = executeSignalToLogin(preLoginPost.value);
  return preLoginFinal.success;
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
  const otpTriggerSubject = buildOtpTriggerPhaseContext({
    phoneHint: REDACTED_PHONE_HINT,
    otpUrl: `${row.loginUrl}/otp`,
  });
  const otpTriggerPost = await executeTriggerPost(otpTriggerSubject.context);
  if (!otpTriggerPost.success) return false;
  const otpTriggerFinal = await executeTriggerFinal(otpTriggerPost.value);
  return otpTriggerFinal.success;
}

/**
 * Run OTP-FILL POST+FINAL for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both OTP-FILL sub-steps succeed.
 */
async function runOtpFill(row: IFullFlowRow): Promise<boolean> {
  const otpFillSubject = buildOtpFillPhaseContext({
    cookieCount: row.cookieCount,
    dashboardUrl: row.dashboardUrl,
  });
  const otpFillPost = await executeFillPost(otpFillSubject.context);
  if (!otpFillPost.success) return false;
  const otpFillFinal = await executeFillFinal(otpFillPost.value);
  return otpFillFinal.success;
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
 * Run AUTH-DISCOVERY.POST for one row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when AUTH-DISCOVERY.POST succeeds.
 */
async function runAuthDiscoveryPost(row: IFullFlowRow): Promise<boolean> {
  const authFixture = loadPhaseFixture(row.bank, 'auth-discovery/last-good');
  const authCookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const authCtx = buildLoginPhaseContext(authFixture, authCookies);
  const authResult = await executeAuthDiscoveryPost(authCtx);
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
  const acctMeta = acctFixture.meta as unknown as { readonly accountsResponseBody?: unknown };
  const acctSubject = buildAccountResolvePhaseContext({
    poolUrl: row.accountsUrl,
    responseBody: acctMeta.accountsResponseBody,
  });
  const acctPost = await executeAccountResolvePost(acctSubject.context);
  if (!acctPost.success) return false;
  const acctFinal = await executeAccountResolveFinal(acctPost.value);
  return acctFinal.success;
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
  const scrapeFinal = await executeStampAccounts(scrapePost.value);
  return scrapeFinal.success;
}

/**
 * Run TERMINATE PRE+POST+FINAL for one row.
 *
 * @returns True when all three TERMINATE sub-steps succeed.
 */
async function runTerminateTail(): Promise<boolean> {
  const termSubject = buildTerminatePhaseContext();
  const termPre = await executeStartCleanup(termSubject.context);
  if (!termPre.success) return false;
  const termPost = await executeLogResults(termPre.value);
  if (!termPost.success) return false;
  const termFinal = await executeSignalDone(termPost.value);
  return termFinal.success;
}

/**
 * Run the AUTH-DISCOVERY → ACCOUNT-RESOLVE → SCRAPE → TERMINATE
 * back-half legs.
 *
 * @param row - Per-bank scenario row.
 * @returns True when every back-half phase succeeds.
 */
async function runBackHalf(row: IFullFlowRow): Promise<boolean> {
  const isAuthOk = await runAuthDiscoveryPost(row);
  if (!isAuthOk) return false;
  const isAcctOk = await runAccountResolve(row);
  if (!isAcctOk) return false;
  const isScrapeOk = await runScrape();
  if (!isScrapeOk) return false;
  return runTerminateTail();
}

describe('FULL-FLOW-FACTORY — Phase H per-bank 10-phase chain', () => {
  it.each(SCENARIOS)(
    'fullFlow_$bank_lastGood_ShouldCompleteEveryPhase',
    async (row): Promise<void> => {
      const didInitHomePass = await runInitHome(row);
      expect(didInitHomePass).toBe(true);
      const didPreLoginLoginPass = await runPreLoginAndLogin(row);
      expect(didPreLoginLoginPass).toBe(true);
      if (row.usesOtp) {
        const didOtpPass = await runOtpLeg(row);
        expect(didOtpPass).toBe(true);
      }
      const didBackPass = await runBackHalf(row);
      expect(didBackPass).toBe(true);
    },
  );
});
