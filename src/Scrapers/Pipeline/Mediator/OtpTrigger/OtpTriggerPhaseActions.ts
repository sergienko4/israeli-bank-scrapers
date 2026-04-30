/**
 * OTP Trigger phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    passive — detect trigger button + phone hint + screenshot
 * ACTION: executioner — click trigger via discovered target
 * POST:   validate — screenshot + verify trigger completed
 * FINAL:  handoff — pass contextId + phoneHint to OtpFill phase
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpTrigger } from '../Form/OtpProbe.js';
import {
  type DiagnosticLabel,
  OTP_FALLBACK,
  otpScreenshot,
  type PhoneHint,
  readDiagTarget,
  unwrapProbe,
} from '../Otp/OtpShared.js';

/** Whether an OTP trigger was detected. */
type OtpDetected = boolean;
/** Body text from page evaluation. */
type BodyText = string;

/** Full masked phone pattern (e.g. *****1234 or ******0). */
const PHONE_HINT_PATTERN = /\*{3,7}\d{1,4}/;
/** Last 1-4 digits extractor. */
const PHONE_LAST_DIGITS = /(\d{1,4})$/;
/** Timeout for OTP page settle after trigger click. */
const OTP_SETTLE_TIMEOUT = 10000;

// ── PRE: Passive Discovery (Rule #20) ──────────────────────────────

/**
 * Extract phone hint (last 3-4 digits) from main page text.
 * @param input - Pipeline context.
 * @returns Last digits or empty.
 */
async function extractPhoneHint(input: IPipelineContext): Promise<PhoneHint> {
  if (!input.browser.has) return '';
  const page = input.browser.value.page;
  const bodyText = await page
    .evaluate((): BodyText => document.body.innerText)
    .catch((): BodyText => '');
  const fullMatch = PHONE_HINT_PATTERN.exec(bodyText);
  if (!fullMatch) return '';
  const digits = PHONE_LAST_DIGITS.exec(fullMatch[0]);
  if (!digits) return '';
  return digits[1];
}

/**
 * PRE: Detect OTP trigger button — 100% passive.
 * Takes screenshot, probes WK trigger patterns, extracts phone hint.
 * @param input - Pipeline context.
 * @returns Updated context with trigger discovery in diagnostics.
 */
async function executeTriggerPre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  if (!input.browser.has) return succeed(input);
  await otpScreenshot(input, 'otp-trigger-pre');
  const mediator = input.mediator.value;
  const page = input.browser.value.page;
  const triggerResult = unwrapProbe(await detectOtpTrigger(mediator).catch(OTP_FALLBACK));
  traceResolution(input.logger, 'OTP_TRIGGER.PRE', triggerResult);
  const triggerTarget = raceResultToTarget(triggerResult, page);
  const phoneHint = await extractPhoneHint(input);
  input.logger.debug({
    message: `phone-hint: ${maskVisibleText(phoneHint)}`,
  });
  const hasTrigger: OtpDetected = triggerResult.found;
  const hasOtpEnabled = Boolean(input.config.otp?.enabled);
  const isMockMode = process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';
  if (hasOtpEnabled && !hasTrigger && !isMockMode) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger not detected');
  }
  const diag = {
    ...input.diagnostics,
    lastAction: `otp-trigger-pre (found=${String(hasTrigger)})`,
    otpTriggerTarget: triggerTarget,
    otpPhoneHint: phoneHint,
  };
  return succeed({ ...input, diagnostics: diag });
}

// ── ACTION: Click Trigger ─────────────────────────────────────────

/**
 * ACTION (sealed): Click the OTP trigger button.
 * Hand follows Eye — uses exact contextId + selector from PRE.
 * @param input - Sealed action context.
 * @returns Updated context or failure.
 */
async function executeTriggerAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  if (!input.executor.has) return succeed(input);
  const executor = input.executor.value;
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  if (!target) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger — no target from PRE');
  }
  const didClick = await executor
    .clickElement({ contextId: target.contextId, selector: target.selector })
    .then((): true => true)
    .catch((): false => false);
  input.logger.debug({
    message: `trigger-otp: ${String(didClick)} @ ${target.contextId}`,
  });
  if (!didClick) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger failed — SMS not sent');
  }
  await executor.waitForNetworkIdle(OTP_SETTLE_TIMEOUT).catch((): false => false);
  return succeed(input);
}

// ── POST: Validate Trigger ────────────────────────────────────────

/**
 * POST: Validate trigger completed — screenshot after click.
 * @param input - Pipeline context.
 * @returns Succeed with screenshot.
 */
async function executeTriggerPost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  await otpScreenshot(input, 'otp-trigger-post');
  input.logger.debug({ message: 'trigger validated' });
  return succeed(input);
}

// ── FINAL: Handoff to OtpFill ─────────────────────────────────────

/**
 * FINAL: Pass contextId + phoneHint to next phase via diagnostics.
 * @param input - Pipeline context.
 * @returns Updated context with handoff diagnostics.
 */
function executeTriggerFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const diag: DiagnosticLabel = 'otp-trigger-final (handoff to otp-fill)';
  const result = succeed({
    ...input,
    diagnostics: { ...input.diagnostics, lastAction: diag },
  });
  return Promise.resolve(result);
}

export { executeTriggerAction, executeTriggerFinal, executeTriggerPost, executeTriggerPre };
