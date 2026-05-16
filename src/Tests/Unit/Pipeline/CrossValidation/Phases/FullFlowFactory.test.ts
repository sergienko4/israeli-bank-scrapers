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
  type PhaseHBank,
} from './Fixtures/_PhaseContextBuilders.js';

/** Per-bank full-flow row. */
interface IFullFlowRow {
  readonly bank: PhaseHBank;
  readonly homepageUrl: string;
  readonly postNavUrl: string;
  readonly loginUrl: string;
  readonly dashboardUrl: string;
  readonly accountsUrl: string;
  readonly frameCount: number;
  readonly usesOtp: boolean;
}

/** Scenarios — one row per PHASE_H_BANK. */
const SCENARIOS: readonly IFullFlowRow[] = [
  {
    bank: 'hapoalim',
    homepageUrl: 'https://www.bankhapoalim.example/',
    postNavUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/',
    loginUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/',
    dashboardUrl: 'https://login.bankhapoalim.example/ng-portals/dashboard',
    accountsUrl: 'https://login.bankhapoalim.example/ServerServices/general/accounts',
    frameCount: 2,
    usesOtp: true,
  },
  {
    bank: 'beinleumi',
    homepageUrl: 'https://www.beinleumi.example/',
    postNavUrl: 'https://login.beinleumi.example/login',
    loginUrl: 'https://login.beinleumi.example/login',
    dashboardUrl: 'https://login.beinleumi.example/dashboard',
    accountsUrl: 'https://login.beinleumi.example/api/accounts',
    frameCount: 0,
    usesOtp: true,
  },
  {
    bank: 'discount',
    homepageUrl: 'https://www.discount.example/',
    postNavUrl: 'https://start.telebank.example/auth',
    loginUrl: 'https://start.telebank.example/auth',
    dashboardUrl: 'https://start.telebank.example/dashboard',
    accountsUrl: 'https://start.telebank.example/api/accounts',
    frameCount: 0,
    usesOtp: false,
  },
  {
    bank: 'amex',
    homepageUrl: 'https://www.amex.example/',
    postNavUrl: 'https://digital.amex.example/login',
    loginUrl: 'https://digital.amex.example/login',
    dashboardUrl: 'https://digital.amex.example/account',
    accountsUrl: 'https://digital.amex.example/api/accounts',
    frameCount: 0,
    usesOtp: false,
  },
  {
    bank: 'isracard',
    homepageUrl: 'https://www.isracard.example/',
    postNavUrl: 'https://digital.isracard.example/personalarea/login',
    loginUrl: 'https://digital.isracard.example/personalarea/login',
    dashboardUrl: 'https://digital.isracard.example/personalarea',
    accountsUrl: 'https://digital.isracard.example/api/accounts',
    frameCount: 0,
    usesOtp: false,
  },
  {
    bank: 'max',
    homepageUrl: 'https://www.max.example/',
    postNavUrl: 'https://www.max.example/login-page',
    loginUrl: 'https://www.max.example/login-page',
    dashboardUrl: 'https://www.max.example/account',
    accountsUrl: 'https://www.max.example/api/accounts',
    frameCount: 0,
    usesOtp: true,
  },
  {
    bank: 'visacal',
    homepageUrl: 'https://www.cal-online.example/',
    postNavUrl: 'https://login.cal-online.example/Login',
    loginUrl: 'https://login.cal-online.example/Login',
    dashboardUrl: 'https://login.cal-online.example/MainPage',
    accountsUrl: 'https://login.cal-online.example/api/accounts',
    frameCount: 0,
    usesOtp: true,
  },
];

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
 * Run INIT.POST + HOME.POST for one bank row.
 *
 * @param row - Per-bank scenario row.
 * @returns True when both phases succeed.
 */
async function runInitHome(row: IFullFlowRow): Promise<boolean> {
  const initSubject = buildInitPhaseContext({ initPostUrl: row.postNavUrl });
  const initResult = await executeValidatePage(initSubject.context);
  if (!initResult.success) return false;
  const homeSubject = buildHomePhaseContext({
    fixture: loadPhaseFixture(row.bank, 'home/last-good'),
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
 * Run PRE-LOGIN.POST+FINAL + LOGIN.FINAL legs.
 *
 * @param row - Per-bank scenario row.
 * @returns True when all three sub-steps succeed.
 */
async function runPreLoginAndLogin(row: IFullFlowRow): Promise<boolean> {
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
  if (!preLoginFinal.success) return false;
  const loginFixture = loadPhaseFixture(row.bank, 'login/last-good');
  const loginCookies = loadLoginFixtureCookies(row.bank, 'last-good');
  const loginCtx = buildLoginPhaseContext(loginFixture, loginCookies);
  const loginFinal = await executeLoginSignal(loginCtx);
  return loginFinal.success;
}

/**
 * Run the OTP-TRIGGER + OTP-FILL legs (only for OTP banks).
 *
 * @param row - Per-bank scenario row.
 * @returns True when both OTP phases succeed end-to-end.
 */
async function runOtpLeg(row: IFullFlowRow): Promise<boolean> {
  const otpTriggerSubject = buildOtpTriggerPhaseContext({
    phoneHint: 'XXX-XXX-FAKE',
    otpUrl: `${row.loginUrl}/otp`,
  });
  const otpTriggerPost = await executeTriggerPost(otpTriggerSubject.context);
  if (!otpTriggerPost.success) return false;
  const otpTriggerFinal = await executeTriggerFinal(otpTriggerPost.value);
  if (!otpTriggerFinal.success) return false;
  const otpFillSubject = buildOtpFillPhaseContext({
    cookieCount: 3,
    dashboardUrl: row.dashboardUrl,
  });
  const otpFillPost = await executeFillPost(otpFillSubject.context);
  if (!otpFillPost.success) return false;
  const otpFillFinal = await executeFillFinal(otpFillPost.value);
  return otpFillFinal.success;
}

/**
 * Run the AUTH-DISCOVERY → ACCOUNT-RESOLVE → SCRAPE → TERMINATE
 * back-half legs.
 *
 * @param row - Per-bank scenario row.
 * @returns True when every back-half phase succeeds.
 */
async function runBackHalf(row: IFullFlowRow): Promise<boolean> {
  const authFixture = loadPhaseFixture(row.bank, 'auth-discovery/last-good');
  const authCookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const authCtx = buildLoginPhaseContext(authFixture, authCookies);
  const authResult = await executeAuthDiscoveryPost(authCtx);
  if (!authResult.success) return false;
  return runResolveScrapeTerminate(row);
}

/**
 * Run the ACCOUNT-RESOLVE → SCRAPE → TERMINATE tail of the chain.
 *
 * @param row - Per-bank scenario row.
 * @returns True when every tail phase succeeds.
 */
async function runResolveScrapeTerminate(row: IFullFlowRow): Promise<boolean> {
  const acctFixture = loadPhaseFixture(row.bank, 'account-resolve/last-good');
  const acctMeta = acctFixture.meta as unknown as { readonly accountsResponseBody?: unknown };
  const acctSubject = buildAccountResolvePhaseContext({
    poolUrl: row.accountsUrl,
    responseBody: acctMeta.accountsResponseBody,
  });
  const acctPost = await executeAccountResolvePost(acctSubject.context);
  if (!acctPost.success) return false;
  const acctFinal = await executeAccountResolveFinal(acctPost.value);
  if (!acctFinal.success) return false;
  const accounts: readonly ITransactionsAccount[] = [
    { accountNumber: 'FAKE-000000', balance: 0, txns: [buildFlowTxn(0)] },
  ];
  const scrapeSubject = buildScrapePhaseContext({ accounts });
  const scrapePost = await executeValidateResults(scrapeSubject.context);
  if (!scrapePost.success) return false;
  const scrapeFinal = await executeStampAccounts(scrapePost.value);
  if (!scrapeFinal.success) return false;
  const termSubject = buildTerminatePhaseContext();
  const termPre = await executeStartCleanup(termSubject.context);
  if (!termPre.success) return false;
  const termPost = await executeLogResults(termPre.value);
  if (!termPost.success) return false;
  const termFinal = await executeSignalDone(termPost.value);
  return termFinal.success;
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
