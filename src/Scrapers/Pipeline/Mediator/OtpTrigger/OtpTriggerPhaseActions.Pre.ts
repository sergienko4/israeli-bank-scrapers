/**
 * OTP-TRIGGER PRE — passive discovery of the trigger button and the
 * phone-hint surfaced to the consumer banner.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpTrigger } from '../Form/OtpProbe.js';
import { PHONE_HINT_PATTERN, PHONE_LAST_DIGITS } from '../Otp/OtpDetectorConfig.js';
import { OTP_FALLBACK, unwrapProbe } from '../Otp/OtpShared.js';

/**
 * Read the visible body text of the main page so the phone-hint
 * regexes can pattern-match. Returns empty string when the page
 * isn't attached or {@link Page.evaluate} rejects (mid-navigation).
 * @param input - Pipeline context carrying the optional browser.
 * @returns Body inner text or `''` when unavailable.
 */
async function readPageBodyText(input: IPipelineContext): Promise<string> {
  if (!input.browser.has) return '';
  return input.browser.value.page
    .evaluate((): string => document.body.innerText)
    .catch((): string => '');
}

/**
 * Match the phone-hint pattern against the page body and pull out the
 * last 3-4 digits substring captured by {@link PHONE_LAST_DIGITS}.
 * @param bodyText - Visible body text of the main page.
 * @returns Last digits captured from the hint, or `''` when no match.
 */
function extractLastDigitsFromBody(bodyText: string): string {
  const fullMatch = PHONE_HINT_PATTERN.exec(bodyText);
  if (!fullMatch) return '';
  const digits = PHONE_LAST_DIGITS.exec(fullMatch[0]);
  if (!digits) return '';
  return digits[1];
}

/**
 * Extract phone hint (last 3-4 digits) from main page text.
 * @param input - Pipeline context.
 * @returns Last digits or empty.
 */
async function extractPhoneHint(input: IPipelineContext): Promise<string> {
  const bodyText = await readPageBodyText(input);
  if (!bodyText) return '';
  return extractLastDigitsFromBody(bodyText);
}

/** Bundled outcome of {@link probeTriggerForPre}. */
interface ITriggerProbeOutcome {
  readonly hasTrigger: boolean;
  readonly triggerTarget: IResolvedTarget | false;
}

/** Bundled args for {@link probeTriggerForPre}. */
interface IProbeTriggerArgs {
  readonly mediator: IElementMediator;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Probe the page for the OTP-trigger element, trace the resolution,
 * and convert the race result to a click target.
 * @param args - Bundle of mediator, page, and pipeline logger.
 * @returns Probe outcome with `hasTrigger` flag and resolved target.
 */
async function probeTriggerForPre(args: IProbeTriggerArgs): Promise<ITriggerProbeOutcome> {
  const triggerResult = unwrapProbe(await detectOtpTrigger(args.mediator).catch(OTP_FALLBACK));
  traceResolution(args.logger, 'OTP_TRIGGER.PRE', triggerResult);
  const triggerTarget = raceResultToTarget(triggerResult, args.page);
  return { hasTrigger: triggerResult.found, triggerTarget };
}

/** Bundled args for {@link buildTriggerPreDiag}. */
interface IPreDiagArgs {
  readonly triggerTarget: IResolvedTarget | false;
  readonly phoneHint: string;
  readonly otpTriggerPreUrl: string;
  readonly hasTrigger: boolean;
}

/** Shape alias for the PRE diagnostics record. */
type PreDiag = IPipelineContext['diagnostics'];

/**
 * Compose the PRE-stage diagnostics patch carrying the trigger probe
 * outcome, phone hint, and URL captured at PRE entry.
 * @param input - Pipeline context (for existing diagnostics).
 * @param args - Bundled PRE outputs to stamp.
 * @returns New diagnostics record.
 */
function buildTriggerPreDiag(input: IPipelineContext, args: IPreDiagArgs): PreDiag {
  const lastAction = `otp-trigger-pre (found=${String(args.hasTrigger)})`;
  const extras: Record<string, unknown> = {
    otpTriggerTarget: args.triggerTarget,
    otpPhoneHint: args.phoneHint,
    otpTriggerPreUrl: args.otpTriggerPreUrl,
  };
  return { ...input.diagnostics, lastAction, ...extras };
}

/** Bundled inputs for {@link finalizeTriggerPre}. */
interface IFinalizePreArgs {
  readonly input: IPipelineContext;
  readonly mediator: IElementMediator;
  readonly hasTrigger: boolean;
  readonly triggerTarget: IResolvedTarget | false;
  readonly phoneHint: string;
}

/** Procedure alias keeping single-line signatures. */
type PreProc = Procedure<IPipelineContext>;

/**
 * Stamp PRE diagnostics or fail loudly when no trigger was detected.
 * @param args - Bundle of context + mediator + PRE outputs.
 * @returns Failure when no trigger, otherwise context with PRE diag.
 */
function finalizeTriggerPre(args: IFinalizePreArgs): PreProc {
  if (!args.hasTrigger) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger not detected');
  }
  const otpTriggerPreUrl = args.mediator.getCurrentUrl();
  const diag = buildTriggerPreDiag(args.input, { ...args, otpTriggerPreUrl });
  return succeed({ ...args.input, diagnostics: diag });
}

/**
 * PRE: Detect OTP trigger button — 100% passive.
 * @param input - Pipeline context.
 * @returns Updated context with trigger discovery in diagnostics.
 */
async function executeTriggerPre(input: IPipelineContext): Promise<PreProc> {
  if (!input.mediator.has || !input.browser.has) return succeed(input);
  const mediator = input.mediator.value;
  const page = input.browser.value.page;
  const probe = await probeTriggerForPre({ mediator, page, logger: input.logger });
  const phoneHint = await extractPhoneHint(input);
  input.logger.debug({ message: `phone-hint: ${maskVisibleText(phoneHint)}` });
  return finalizeTriggerPre({ input, mediator, ...probe, phoneHint });
}

export default executeTriggerPre;
