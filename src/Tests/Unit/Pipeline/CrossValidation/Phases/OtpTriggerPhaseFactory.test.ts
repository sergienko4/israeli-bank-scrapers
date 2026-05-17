/**
 * Phase H+ - cross-bank OTP-TRIGGER per-phase factory (DEEP).
 *
 * <p>Honors the locked plan factory-depth expectation: drives
 * PRE -> ACTION -> POST -> FINAL chain per OTP-using bank through
 * real production code paths.
 *
 * <ul>
 *   <li>PRE: {@link executeTriggerPre} - DOM-scan trigger probe via
 *     mediator.resolveVisible + phone-hint extraction + commits
 *     otpTriggerTarget into diagnostics.</li>
 *   <li>ACTION: {@link executeTriggerAction} - sealed click on
 *     PRE-committed target via executor.</li>
 *   <li>POST: {@link executeTriggerPost} - scope-validate (target
 *     gone OR 2xx ACK).</li>
 *   <li>FINAL: {@link executeTriggerFinal} - builds IOtpTrigger
 *     snapshot + commits ctx.otpTrigger.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers + the
 * shared {@link unwrapOrThrow} from `_deepPhaseHelpers.ts`.
 *
 * <p>Scope: 4 OTP-using banks (hapoalim, beinleumi, max,
 * visacal). Discount/Amex/Isracard use password-only login.
 */

import {
  executeTriggerAction,
  executeTriggerFinal,
  executeTriggerPost,
  executeTriggerPre,
} from '../../../../../Scrapers/Pipeline/Mediator/OtpTrigger/OtpTriggerPhaseActions.js';
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

/** OTP-using bank subset of the shared BANK_SCENARIOS table. */
const OTP_BANK_SCENARIOS: readonly IBankScenario[] = BANK_SCENARIOS.filter(
  (s): boolean => s.usesOtp,
);

/** Bundle returned by {@link prepareOtpTriggerRow}. */
interface IOtpTriggerRowSetup {
  readonly row: IBankScenario;
  readonly subject: IDeepLoginTestSubject;
}

/**
 * Build the deep OTP-TRIGGER test subject. Reuses
 * {@link buildDeepLoginContext} since OTP-TRIGGER shares mediator
 * surfaces with LOGIN (resolveVisible, network.*).
 *
 * @param row - OTP-using bank scenario row.
 * @returns Row + deep test subject.
 */
function prepareOtpTriggerRow(row: IBankScenario): IOtpTriggerRowSetup {
  const cookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const subject = buildDeepLoginContext({
    loginConfig: PLACEHOLDER_LOGIN_CONFIG,
    loginUrl: `${row.loginUrl}/otp`,
    cookies,
  });
  return { row, subject };
}

/**
 * Drive OTP-TRIGGER.PRE via production executeTriggerPre.
 *
 * @param setup - Row + deep test subject.
 * @returns PRE-updated pipeline context.
 */
async function runOtpTriggerPre(setup: IOtpTriggerRowSetup): Promise<IPipelineContext> {
  const result = await executeTriggerPre(setup.subject.context);
  return unwrapOrThrow(result, `OTP_TRIGGER_PRE_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive OTP-TRIGGER.ACTION via production executeTriggerAction.
 *
 * @param setup - Row + deep test subject.
 * @param preCtx - PRE-updated context.
 * @returns ACTION-updated action context.
 */
async function runOtpTriggerAction(
  setup: IOtpTriggerRowSetup,
  preCtx: IPipelineContext,
): Promise<IActionContext> {
  const actionCtx = toActionCtx(preCtx, setup.subject.executor);
  const result = await executeTriggerAction(actionCtx);
  return unwrapOrThrow(result, `OTP_TRIGGER_ACTION_FAILED bank=${setup.row.bank}`);
}

/**
 * Merge ACTION diagnostics back into the full context for POST.
 *
 * @param preCtx - PRE context (mediator/browser/login).
 * @param actionCtx - ACTION context (diagnostics).
 * @returns Merged pipeline context.
 */
function mergeForPost(preCtx: IPipelineContext, actionCtx: IActionContext): IPipelineContext {
  return { ...preCtx, diagnostics: actionCtx.diagnostics };
}

/**
 * Drive OTP-TRIGGER.POST via production handler.
 *
 * @param setup - Row + deep test subject.
 * @param postInput - Merged pre+action context.
 * @returns POST-updated context.
 */
async function runOtpTriggerPost(
  setup: IOtpTriggerRowSetup,
  postInput: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeTriggerPost(postInput);
  return unwrapOrThrow(result, `OTP_TRIGGER_POST_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive OTP-TRIGGER.FINAL via production handler.
 *
 * @param setup - Row + deep test subject.
 * @param postCtx - POST-updated context.
 * @returns FINAL-updated context.
 */
async function runOtpTriggerFinal(
  setup: IOtpTriggerRowSetup,
  postCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeTriggerFinal(postCtx);
  return unwrapOrThrow(result, `OTP_TRIGGER_FINAL_FAILED bank=${setup.row.bank}`);
}

/**
 * Run the full OTP-TRIGGER PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + deep test subject.
 * @returns FINAL pipeline context.
 */
async function runOtpTriggerChain(setup: IOtpTriggerRowSetup): Promise<IPipelineContext> {
  const preCtx = await runOtpTriggerPre(setup);
  const actionCtx = await runOtpTriggerAction(setup, preCtx);
  const postInput = mergeForPost(preCtx, actionCtx);
  const postCtx = await runOtpTriggerPost(setup, postInput);
  return runOtpTriggerFinal(setup, postCtx);
}

/**
 * Assert ctx.otpTrigger committed AND `triggered === true`.
 *
 * <p>Asserts the documented FINAL contract — presence-only checks
 * miss state where the snapshot is committed with `triggered=false`
 * (CodeRabbit cycle #3 finding #6).
 *
 * @param finalCtx - Context after the chain.
 * @returns True after assertion.
 */
function assertOtpTriggerShape(finalCtx: IPipelineContext): boolean {
  expect(finalCtx.otpTrigger.has).toBe(true);
  if (finalCtx.otpTrigger.has) {
    expect(finalCtx.otpTrigger.value.triggered).toBe(true);
  }
  return true;
}

describe('OTP-TRIGGER-PHASE-FACTORY - DEEP cross-bank PRE-ACTION-POST-FINAL', () => {
  it.each(OTP_BANK_SCENARIOS)(
    'otpTrigger_$bank_ShouldCompleteFullChain',
    async (row): Promise<void> => {
      const setup = prepareOtpTriggerRow(row);
      const finalCtx = await runOtpTriggerChain(setup);
      assertOtpTriggerShape(finalCtx);
    },
  );
});
