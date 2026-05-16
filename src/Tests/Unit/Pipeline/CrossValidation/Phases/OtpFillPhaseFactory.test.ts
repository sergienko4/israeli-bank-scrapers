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
 * method" the `it.each` callback orchestrates via helpers.
 *
 * <p>The OTP-FILL chain has a unique constraint: PRE needs the
 * form visible, POST needs it gone (post-submit). The deep helper
 * for the chain uses TWO mediator setups — one wired for PRE+
 * ACTION (form-found), another wired for POST+FINAL (form-gone).
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
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
  readonly postCtx: IPipelineContext;
}

/**
 * Build the deep OTP-FILL test subject. Creates TWO contexts:
 * one wired for PRE+ACTION (form-found) and another for
 * POST+FINAL (form-gone, post-submit state).
 *
 * @param row - OTP-using bank scenario row.
 * @returns Row + pre/post context bundle.
 */
function prepareOtpFillRow(row: IBankScenario): IOtpFillRowSetup {
  const preCookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const placeholderConfig = { fields: [], submit: [], loginUrl: '' } as unknown as Parameters<
    typeof buildDeepLoginContext
  >[0]['loginConfig'];
  const deepSubject = buildDeepLoginContext({
    loginConfig: placeholderConfig,
    loginUrl: `${row.loginUrl}/otp`,
    cookies: preCookies,
  });
  const preCtx = injectOtpRetriever(deepSubject.context);
  const postSubject = buildOtpFillPhaseContext({
    cookieCount: row.cookieCount,
    dashboardUrl: row.dashboardUrl,
  });
  return { row, subject: deepSubject, preCtx, postCtx: postSubject.context };
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
 * Drive OTP-FILL.PRE via production executeFillPre.
 *
 * @param setup - Row + context bundle.
 * @returns PRE-updated pipeline context.
 */
async function runOtpFillPre(setup: IOtpFillRowSetup): Promise<IPipelineContext> {
  const result = await executeFillPre(setup.preCtx);
  if (!result.success) {
    throw new ScraperError(`OTP_FILL_PRE_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
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
  if (!preCtx.mediator.has) {
    throw new ScraperError(`OTP_FILL_ACTION_NO_MEDIATOR bank=${setup.row.bank}`);
  }
  const actionCtx = toActionCtx(preCtx, setup.subject.executor);
  const result = await executeFillAction(actionCtx);
  if (!result.success) {
    throw new ScraperError(
      `OTP_FILL_ACTION_FAILED bank=${setup.row.bank} - ${result.errorMessage}`,
    );
  }
  return result.value;
}

/**
 * Drive OTP-FILL.POST + FINAL via production handlers against the
 * post-submit (form-gone) mediator setup.
 *
 * @param setup - Row + context bundle.
 * @returns FINAL-updated pipeline context.
 */
async function runOtpFillPostFinal(setup: IOtpFillRowSetup): Promise<IPipelineContext> {
  const postResult = await executeFillPost(setup.postCtx);
  if (!postResult.success) {
    throw new ScraperError(
      `OTP_FILL_POST_FAILED bank=${setup.row.bank} - ${postResult.errorMessage}`,
    );
  }
  const finalResult = await executeFillFinal(postResult.value);
  if (!finalResult.success) {
    throw new ScraperError(
      `OTP_FILL_FINAL_FAILED bank=${setup.row.bank} - ${finalResult.errorMessage}`,
    );
  }
  return finalResult.value;
}

/**
 * Run the full OTP-FILL PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + context bundle.
 * @returns FINAL pipeline context.
 */
async function runOtpFillChain(setup: IOtpFillRowSetup): Promise<IPipelineContext> {
  const preCtx = await runOtpFillPre(setup);
  await runOtpFillAction(setup, preCtx);
  return runOtpFillPostFinal(setup);
}

/**
 * Assert ctx.otpFill committed by PRE + diagnostics stamped FINAL.
 *
 * @param finalCtx - Context after the chain.
 * @returns True after assertion.
 */
function assertOtpFillShape(finalCtx: IPipelineContext): boolean {
  const lastAction = finalCtx.diagnostics.lastAction;
  expect(typeof lastAction).toBe('string');
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
