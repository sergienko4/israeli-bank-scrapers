/**
 * Phase H+ — cross-bank LOGIN per-phase factory (DEEP).
 *
 * <p>Honors the originally-locked H.T3c.4 spec: "FULL Playwright-
 * page mocked replay (PRE → ACTION → POST → FINAL). New MockPage +
 * MockNetwork infra script DOM responses from fixture; factory
 * replays the full LOGIN flow per bank." Each row chains all four
 * sub-steps through production code with bank-specific
 * {@link ILoginConfig} loaded from the actual bank module.
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback delegates to small per-step
 * helpers (`runLoginPre`, `runLoginAction`, `runLoginPost`,
 * `runLoginFinal`).
 *
 * <p>Per `testing-organization-guidlines.md` "integration over
 * unit, unit for edge cases only" — this factory is the
 * integration tier driving production action handlers end-to-end
 * across all 7 PHASE_H_BANKS. The pre-existing
 * `LoginFactoryTest.test.ts` (M2.T10) remains the isolation tier
 * for edge cases the integration chain doesn't reach.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeLoginSignal,
  executeValidateLogin,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import {
  API_STRATEGY,
  type IActionContext,
  type IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { toActionCtx } from '../../Infrastructure/TestHelpers.js';
import BANK_LOGIN_CONFIGS from './Fixtures/_bankLoginConfigs.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import { unwrapOrThrow } from './Fixtures/_deepPhaseHelpers.js';
import { buildDeepLoginContext } from './Fixtures/_makeDeepLoginPhaseContext.js';
import { loadAuthDiscoveryFixtureCookies } from './Fixtures/_makeLoginPhaseContext.js';
import { type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface ILoginScenarioRow {
  readonly bank: PhaseHBank;
  readonly loginConfig: ILoginConfig;
  readonly loginUrl: string;
}

/** Derive LOGIN scenarios from the shared {@link BANK_SCENARIOS} source. */
const SCENARIOS: readonly ILoginScenarioRow[] = BANK_SCENARIOS.map(toLoginRow);

/**
 * Map one {@link IBankScenario} to the local LOGIN row shape.
 *
 * @param row - Shared bank scenario row.
 * @returns Local LOGIN row (bank + loginConfig + loginUrl).
 */
function toLoginRow(row: IBankScenario): ILoginScenarioRow {
  return { bank: row.bank, loginConfig: BANK_LOGIN_CONFIGS[row.bank], loginUrl: row.loginUrl };
}

/** Result of {@link prepareLoginRow}. */
interface ILoginRowSubject {
  readonly row: ILoginScenarioRow;
  readonly subject: ReturnType<typeof buildDeepLoginContext>;
}

/**
 * Load the bank's captured cookie snapshot + build the deep
 * LOGIN context for that bank.
 *
 * @param row - Scenario row identifying bank + loginConfig + URL.
 * @returns Row paired with the built deep test subject.
 */
function prepareLoginRow(row: ILoginScenarioRow): ILoginRowSubject {
  const cookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const subject = buildDeepLoginContext({
    loginConfig: row.loginConfig,
    loginUrl: row.loginUrl,
    cookies,
  });
  return { row, subject };
}

/**
 * Drive LOGIN.PRE through production code with the bank's real
 * {@link ILoginConfig}. Returns the PRE-updated context when
 * successful, or throws a typed error tagged with the bank.
 *
 * @param prepared - Row + subject from {@link prepareLoginRow}.
 * @returns PRE-updated pipeline context.
 */
async function runLoginPre(prepared: ILoginRowSubject): Promise<IPipelineContext> {
  const result = await executeDiscoverForm(prepared.row.loginConfig, prepared.subject.context);
  return unwrapOrThrow(result, `LOGIN_PRE_FAILED bank=${prepared.row.bank}`);
}

/**
 * Drive LOGIN.ACTION through production code with the deep
 * executor wired in the test subject. Builds the sealed
 * {@link IActionContext} required by the action handler.
 *
 * @param prepared - Row + subject.
 * @param preCtx - Context committed by PRE (carries loginFieldDiscovery).
 * @returns ACTION-updated action context.
 */
async function runLoginAction(
  prepared: ILoginRowSubject,
  preCtx: IPipelineContext,
): Promise<IActionContext> {
  const actionCtx = toActionCtx(preCtx, prepared.subject.executor);
  const result = await executeFillAndSubmitFromDiscovery(prepared.row.loginConfig, actionCtx);
  return unwrapOrThrow(result, `LOGIN_ACTION_FAILED bank=${prepared.row.bank}`);
}

/**
 * Drive LOGIN.POST through production code. Promotes the ACTION
 * context back to a full {@link IPipelineContext} for the POST
 * handler (POST reads browser/mediator/login that ACTION's sealed
 * context preserves at runtime).
 *
 * @param prepared - Row + subject.
 * @param preCtx - The PRE-updated pipeline context.
 * @returns POST-updated pipeline context.
 */
async function runLoginPost(
  prepared: ILoginRowSubject,
  preCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const mediator = preCtx.mediator;
  if (!mediator.has) throw new ScraperError(`LOGIN_POST_NO_MEDIATOR bank=${prepared.row.bank}`);
  const result = await executeValidateLogin(prepared.row.loginConfig, mediator.value, preCtx);
  return unwrapOrThrow(result, `LOGIN_POST_FAILED bank=${prepared.row.bank}`);
}

/**
 * Drive LOGIN.FINAL through production code. Asserts cookie audit
 * commits {@link API_STRATEGY.DIRECT} with >= 1 session cookie.
 *
 * @param prepared - Row + subject.
 * @param postCtx - POST-updated pipeline context.
 * @returns FINAL-updated pipeline context.
 */
async function runLoginFinal(
  prepared: ILoginRowSubject,
  postCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeLoginSignal(postCtx);
  return unwrapOrThrow(result, `LOGIN_FINAL_FAILED bank=${prepared.row.bank}`);
}

/**
 * Run the full LOGIN PRE → ACTION → POST → FINAL chain for one
 * bank. Each per-sub-step helper throws on failure so the test
 * surfaces the first regression without silent skipping.
 *
 * <p>ACTION's diagnostics (notably `submitMethod`) propagate to
 * POST via {@link mergeActionDiagnostics} so the chain mirrors
 * production threading instead of skipping ACTION's commits
 * (CodeRabbit 2026-05-16 finding #25).
 *
 * @param prepared - Row + deep test subject.
 * @returns FINAL pipeline context (success path).
 */
async function runLoginChain(prepared: ILoginRowSubject): Promise<IPipelineContext> {
  const preCtx = await runLoginPre(prepared);
  const actionCtx = await runLoginAction(prepared, preCtx);
  const postInput = mergeActionDiagnostics(preCtx, actionCtx);
  const postCtx = await runLoginPost(prepared, postInput);
  return runLoginFinal(prepared, postCtx);
}

/**
 * Merge ACTION's diagnostics commits back into the PRE-updated
 * full pipeline context so POST reads the same state production
 * sees. Production sealing strips `mediator`/`browser`/`login`
 * from {@link IActionContext}; the test rehydrates them from
 * preCtx while preserving ACTION's diagnostic stamps.
 *
 * @param preCtx - PRE-updated pipeline context (browser/mediator/login).
 * @param actionCtx - ACTION-updated sealed context (diagnostics).
 * @returns Merged pipeline context for POST input.
 */
function mergeActionDiagnostics(
  preCtx: IPipelineContext,
  actionCtx: IActionContext,
): IPipelineContext {
  return { ...preCtx, diagnostics: actionCtx.diagnostics };
}

/**
 * Assert the FINAL-stage commits match the LOGIN contract:
 * <ul>
 *   <li>login state present + loginFieldDiscovery populated</li>
 *   <li>cookie-audit observed at least one cookie — `executeLoginSignal`
 *     only stamps `diagnostics.apiStrategy = API_STRATEGY.DIRECT` after
 *     proving `cookies.length > 0`, so this assertion is the strongest
 *     proxy for "≥1 cookie" without reaching past the contract</li>
 * </ul>
 *
 * @param finalCtx - Context after the full chain.
 * @returns Resolved when assertions complete.
 */
function assertLoginFinalShape(finalCtx: IPipelineContext): boolean {
  expect(finalCtx.login.has).toBe(true);
  expect(finalCtx.loginFieldDiscovery.has).toBe(true);
  expect(finalCtx.diagnostics.apiStrategy).toBe(API_STRATEGY.DIRECT);
  return true;
}

describe('LOGIN-PHASE-FACTORY — DEEP cross-bank PRE→ACTION→POST→FINAL', () => {
  it.each(SCENARIOS)('login_$bank_ShouldCompleteFullChain', async (row): Promise<void> => {
    const prepared = prepareLoginRow(row);
    const finalCtx = await runLoginChain(prepared);
    assertLoginFinalShape(finalCtx);
  });
});
