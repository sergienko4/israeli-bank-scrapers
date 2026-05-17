/**
 * Phase H+ - cross-bank OTP-FILL per-phase factory (DEEP).
 *
 * <p>Honors the locked plan factory-depth expectation: drives the
 * full PRE -> ACTION -> POST -> FINAL chain per OTP-using bank
 * through real production code paths.
 *
 * <ul>
 *   <li>PRE: {@link executeFillPre} - probe OTP input + submit
 *     via mediator.resolveVisible, commit targets to diagnostics.</li>
 *   <li>ACTION: {@link executeFillAction} - fetch OTP code via
 *     options.otpCodeRetriever, fill input, click submit.</li>
 *   <li>POST: {@link executeFillPost} - validate OTP accepted
 *     (form gone, no error).</li>
 *   <li>FINAL: {@link executeFillFinal} - cookie audit + URL stamp.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers + the
 * shared {@link unwrapOrThrow} from `_deepPhaseHelpers.ts`.
 *
 * <p>The OTP-FILL chain has a unique constraint: PRE needs the
 * form visible, POST needs it gone (post-submit). The factory
 * uses TWO mediator setups — one wired for PRE+ACTION (form-found),
 * another for POST+FINAL (form-gone) — and MERGES the ACTION
 * diagnostics into the form-gone context so the state-handoff
 * stays observable (CodeRabbit cycle #3 finding #5 +
 * `PostUsesActionContext` canary).
 */

import {
  executeFillAction,
  executeFillFinal,
  executeFillPost,
  executeFillPre,
} from '../../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { toActionCtx } from '../../Infrastructure/TestHelpers.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import { PLACEHOLDER_LOGIN_CONFIG, unwrapOrThrow } from './Fixtures/_deepPhaseHelpers.js';
import {
  buildDeepLoginContext,
  type IDeepLoginTestSubject,
} from './Fixtures/_makeDeepLoginPhaseContext.js';
import { loadAuthDiscoveryFixtureCookies } from './Fixtures/_makeLoginPhaseContext.js';
import { buildOtpFillPhaseContext } from './Fixtures/_makeOtpFillPhaseContext.js';

/** OTP-using bank subset of the shared scenarios. */
const OTP_BANK_SCENARIOS: readonly IBankScenario[] = BANK_SCENARIOS.filter(
  (s): boolean => s.usesOtp,
);

/** FAKE otp code returned by the test retriever (PII-redacted). */
const FAKE_OTP_CODE = '000000';

/** Bundle returned by {@link prepareOtpFillRow}. */
interface IOtpFillRowSetup {
  readonly row: IBankScenario;
  readonly subject: IDeepLoginTestSubject;
  readonly preCtx: IPipelineContext;
  readonly postTemplate: IPipelineContext;
}

/**
 * Build the deep OTP-FILL test subject. Creates TWO contexts:
 * one wired for PRE+ACTION (form-found) and another for
 * POST+FINAL (form-gone, post-submit state).
 *
 * @param row - OTP-using bank scenario row.
 * @returns Row + pre/post-template context bundle.
 */
function prepareOtpFillRow(row: IBankScenario): IOtpFillRowSetup {
  const deepSubject = buildDeepSubject(row);
  const preCtx = injectOtpRetriever(deepSubject.context);
  const postSubject = buildOtpFillPhaseContext({
    cookieCount: row.cookieCount,
    dashboardUrl: row.dashboardUrl,
  });
  return { row, subject: deepSubject, preCtx, postTemplate: postSubject.context };
}

/**
 * Build the deep LOGIN subject reused for OTP-FILL PRE+ACTION.
 *
 * @param row - OTP-using bank scenario row.
 * @returns Deep test subject (context + executor).
 */
function buildDeepSubject(row: IBankScenario): ReturnType<typeof buildDeepLoginContext> {
  return buildDeepLoginContext({
    loginConfig: PLACEHOLDER_LOGIN_CONFIG,
    loginUrl: `${row.loginUrl}/otp`,
    cookies: loadAuthDiscoveryFixtureCookies(row.bank, 'last-good'),
  });
}

/**
 * Inject a FAKE-code otpCodeRetriever into options so ACTION can
 * resolve a code without a real user interaction.
 *
 * @param context - Base pipeline context.
 * @returns Context with options.otpCodeRetriever populated.
 */
function injectOtpRetriever(context: IPipelineContext): IPipelineContext {
  const extendedOptions: IPipelineContext['options'] = {
    ...context.options,
    /**
     * Test OTP retriever - returns the FAKE redacted code.
     * @returns Resolved FAKE_OTP_CODE.
     */
    otpCodeRetriever: (): Promise<string> => Promise.resolve(FAKE_OTP_CODE),
  };
  return { ...context, options: extendedOptions };
}

/**
 * Build the POST-input context. The form-gone post-template
 * mediator + browser overlay onto PRE, and the ACTION diagnostics
 * are propagated so handoff stays observable (rabbit cycle #3
 * finding #5).
 *
 * @param preCtx - PRE-updated context (form-found).
 * @param actionCtx - ACTION context (diagnostics + sealed state).
 * @param postTemplate - Form-gone template (mediator/browser).
 * @returns Merged context for POST.
 */
function buildOtpFillPostInput(
  preCtx: IPipelineContext,
  actionCtx: IActionContext,
  postTemplate: IPipelineContext,
): IPipelineContext {
  return { ...preCtx, ...postTemplate, diagnostics: actionCtx.diagnostics };
}

/**
 * Drive OTP-FILL.PRE via production executeFillPre.
 *
 * @param setup - Row + context bundle.
 * @returns PRE-updated pipeline context.
 */
async function runOtpFillPre(setup: IOtpFillRowSetup): Promise<IPipelineContext> {
  const result = await executeFillPre(setup.preCtx);
  return unwrapOrThrow(result, `OTP_FILL_PRE_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive OTP-FILL.ACTION via production executeFillAction.
 *
 * @param setup - Row + context bundle.
 * @param preCtx - PRE-updated context.
 * @returns ACTION-updated action context.
 */
async function runOtpFillAction(
  setup: IOtpFillRowSetup,
  preCtx: IPipelineContext,
): Promise<IActionContext> {
  const actionCtx = toActionCtx(preCtx, setup.subject.executor);
  const result = await executeFillAction(actionCtx);
  return unwrapOrThrow(result, `OTP_FILL_ACTION_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive OTP-FILL.POST via production executeFillPost against the
 * merged ACTION-threaded post-submit context.
 *
 * @param setup - Row + context bundle.
 * @param postInput - Merged context (PRE + post-template + ACTION diagnostics).
 * @returns POST-updated pipeline context.
 */
async function runOtpFillPost(
  setup: IOtpFillRowSetup,
  postInput: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeFillPost(postInput);
  return unwrapOrThrow(result, `OTP_FILL_POST_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive OTP-FILL.FINAL via production executeFillFinal.
 *
 * @param setup - Row + context bundle.
 * @param postCtx - POST-updated context.
 * @returns FINAL-updated pipeline context.
 */
async function runOtpFillFinal(
  setup: IOtpFillRowSetup,
  postCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeFillFinal(postCtx);
  return unwrapOrThrow(result, `OTP_FILL_FINAL_FAILED bank=${setup.row.bank}`);
}

/**
 * Run the full OTP-FILL PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + context bundle.
 * @returns FINAL pipeline context.
 */
async function runOtpFillChain(setup: IOtpFillRowSetup): Promise<IPipelineContext> {
  const preCtx = await runOtpFillPre(setup);
  const actionCtx = await runOtpFillAction(setup, preCtx);
  const postInput = buildOtpFillPostInput(preCtx, actionCtx, setup.postTemplate);
  const postCtx = await runOtpFillPost(setup, postInput);
  return runOtpFillFinal(setup, postCtx);
}

/**
 * Assert FINAL stamped diagnostics.lastAction.
 *
 * @param finalCtx - Context after the chain.
 * @returns True after assertion.
 */
function assertOtpFillShape(finalCtx: IPipelineContext): boolean {
  expect(typeof finalCtx.diagnostics.lastAction).toBe('string');
  return true;
}

describe('OTP-FILL-PHASE-FACTORY - DEEP cross-bank PRE-ACTION-POST-FINAL', () => {
  it.each(OTP_BANK_SCENARIOS)(
    'otpFill_$bank_ShouldCompleteFullChain',
    async (row): Promise<void> => {
      const setup = prepareOtpFillRow(row);
      const finalCtx = await runOtpFillChain(setup);
      assertOtpFillShape(finalCtx);
    },
  );
});
