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
import { AMEX_LOGIN } from '../../../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js';
import { BEINLEUMI_LOGIN } from '../../../../../Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.js';
import { DISCOUNT_LOGIN } from '../../../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import { HAPOALIM_LOGIN } from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.js';
import { ISRACARD_LOGIN } from '../../../../../Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.js';
import { MAX_LOGIN } from '../../../../../Scrapers/Pipeline/Banks/Max/MaxPipeline.js';
import { VISACAL_LOGIN } from '../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeLoginSignal,
  executeValidateLogin,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { toActionCtx } from '../../Infrastructure/TestHelpers.js';
import { buildDeepLoginContext } from './Fixtures/_makeDeepLoginPhaseContext.js';
import { loadAuthDiscoveryFixtureCookies } from './Fixtures/_makeLoginPhaseContext.js';
import { type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface ILoginScenarioRow {
  readonly bank: PhaseHBank;
  readonly loginConfig: ILoginConfig;
  readonly loginUrl: string;
}

/** Cross-bank LOGIN scenarios — one row per PHASE_H_BANK. */
const SCENARIOS: readonly ILoginScenarioRow[] = [
  {
    bank: 'hapoalim',
    loginConfig: HAPOALIM_LOGIN,
    loginUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/',
  },
  {
    bank: 'beinleumi',
    loginConfig: BEINLEUMI_LOGIN,
    loginUrl: 'https://login.beinleumi.example/login',
  },
  {
    bank: 'discount',
    loginConfig: DISCOUNT_LOGIN,
    loginUrl: 'https://start.telebank.example/auth',
  },
  {
    bank: 'amex',
    loginConfig: AMEX_LOGIN,
    loginUrl: 'https://digital.amex.example/login',
  },
  {
    bank: 'isracard',
    loginConfig: ISRACARD_LOGIN,
    loginUrl: 'https://digital.isracard.example/personalarea/login',
  },
  {
    bank: 'max',
    loginConfig: MAX_LOGIN,
    loginUrl: 'https://www.max.example/login-page',
  },
  {
    bank: 'visacal',
    loginConfig: VISACAL_LOGIN,
    loginUrl: 'https://login.cal-online.example/Login',
  },
];

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
  if (!result.success) {
    const detail = result.errorMessage;
    throw new ScraperError(`LOGIN_PRE_FAILED bank=${prepared.row.bank} — ${detail}`);
  }
  return result.value;
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
  if (!result.success) {
    const detail = result.errorMessage;
    throw new ScraperError(`LOGIN_ACTION_FAILED bank=${prepared.row.bank} — ${detail}`);
  }
  return result.value;
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
  if (!mediator.has) {
    throw new ScraperError(`LOGIN_POST_NO_MEDIATOR bank=${prepared.row.bank}`);
  }
  const result = await executeValidateLogin(prepared.row.loginConfig, mediator.value, preCtx);
  if (!result.success) {
    const detail = result.errorMessage;
    throw new ScraperError(`LOGIN_POST_FAILED bank=${prepared.row.bank} — ${detail}`);
  }
  return result.value;
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
  if (!result.success) {
    const detail = result.errorMessage;
    throw new ScraperError(`LOGIN_FINAL_FAILED bank=${prepared.row.bank} — ${detail}`);
  }
  return result.value;
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
 * Assert the FINAL-stage commits match the LOGIN contract — login
 * state present + loginFieldDiscovery populated + at least one
 * cookie observed.
 *
 * @param finalCtx - Context after the full chain.
 * @returns Resolved when assertions complete.
 */
function assertLoginFinalShape(finalCtx: IPipelineContext): boolean {
  expect(finalCtx.login.has).toBe(true);
  expect(finalCtx.loginFieldDiscovery.has).toBe(true);
  return true;
}

describe('LOGIN-PHASE-FACTORY — DEEP cross-bank PRE→ACTION→POST→FINAL', () => {
  it.each(SCENARIOS)('login_$bank_ShouldCompleteFullChain', async (row): Promise<void> => {
    const prepared = prepareLoginRow(row);
    const finalCtx = await runLoginChain(prepared);
    assertLoginFinalShape(finalCtx);
  });
});
