/**
 * OTP-FILL PRE — passive discovery of the OTP code input and submit
 * button. Stamps targets into diagnostics for the ACTION + POST stages.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type { IOtpFill, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpForm, detectOtpSubmit } from '../Form/OtpProbe.js';
import { OTP_FALLBACK, unwrapProbe } from '../Otp/OtpShared.js';
import extractDeepPhoneHint from './OtpFillPhaseActions.PhoneHint.js';

/**
 * True when MOCK_MODE is active — lets OTP-PRE short-circuit.
 * @returns Whether MOCK_MODE selects the offline snapshot bypass.
 */
function isMockModeOtpActive(): boolean {
  return process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';
}

/**
 * Build the OTP-FILL emit by COPYING the predecessor's
 * {@link IOtpFill.urlBeforeSubmit} forward (Mission M4.F1 baton).
 * @param input - Pipeline context (carries the predecessor emit).
 * @returns OTP-FILL emit with the inherited URL.
 */
function carryUrlForward(input: IPipelineContext): IOtpFill {
  if (input.otpTrigger.has) return { urlBeforeSubmit: input.otpTrigger.value.urlBeforeSubmit };
  if (input.login.has) return { urlBeforeSubmit: input.login.value.urlBeforeSubmit };
  return { urlBeforeSubmit: '' };
}

/** Procedure alias keeping single-line signatures. */
type PreProc = Procedure<IPipelineContext>;

/**
 * Build a soft-skip OTP-FILL emit carrying the predecessor URL forward.
 * @param input - Pipeline context.
 * @param label - Diagnostic `lastAction` value (greppable in logs).
 * @returns Succeed with diag + carry-forward emit.
 */
function emitSoftSkipFillPre(input: IPipelineContext, label: string): PreProc {
  const diag = { ...input.diagnostics, lastAction: label };
  const carriedEmit = carryUrlForward(input);
  return succeed({ ...input, diagnostics: diag, otpFill: some(carriedEmit) });
}

/**
 * Optional-skip path: log the soft-skip rationale then emit.
 * @param input - Pipeline context.
 * @returns Soft-skip OTP-FILL emit.
 */
function emitOptionalSkipFillPre(input: IPipelineContext): PreProc {
  input.logger.info({
    message: '>>> OTP input missing — withOtpFill(required=false), soft-skipping OTP-FILL',
  });
  return emitSoftSkipFillPre(input, 'otp-fill-pre (optional-skip)');
}

/**
 * Handle the "OTP input not found" case.
 * @param input - Pipeline context at PRE time.
 * @param required - Whether OTP is mandatory (false soft-skips on miss).
 * @returns Procedure with the appropriate diagnostic stamp.
 */
function handleMissingOtpInput(input: IPipelineContext, required: boolean): PreProc {
  if (isMockModeOtpActive()) return emitSoftSkipFillPre(input, 'otp-fill-pre (mock-bypass)');
  if (!required) return emitOptionalSkipFillPre(input);
  return fail(ScraperErrorTypes.Generic, 'OTP code input not found');
}

/** Bundled args for {@link probeOtpFillTargets}. */
interface IProbeFillArgs {
  readonly mediator: IElementMediator;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}

/** Bundled outcome of {@link probeOtpFillTargets}. */
interface IFillTargetsResult {
  readonly inputTarget: ReturnType<typeof raceResultToTarget>;
  readonly submitTarget: ReturnType<typeof raceResultToTarget>;
  readonly hasInput: boolean;
  readonly hasSubmit: boolean;
}

/** Pairs raw RaceResult with derived click target. */
interface IOtpProbeWithTarget {
  readonly result: IRaceResult;
  readonly target: ReturnType<typeof raceResultToTarget>;
}

/**
 * Probe for the OTP code input via the well-known patterns.
 * @param args - Bundle of mediator, page, and pipeline logger.
 * @returns Resolution result + derived input target.
 */
async function probeOtpInputForm(args: IProbeFillArgs): Promise<IOtpProbeWithTarget> {
  const probe = await detectOtpForm(args.mediator).catch(OTP_FALLBACK);
  const result = unwrapProbe(probe);
  traceResolution(args.logger, 'OTP_FILL.PRE input', result);
  return { result, target: raceResultToTarget(result, args.page) };
}

/** Detected submit-context type returned by the input probe. */
type RawCtx = Page | Frame | false;

/** Type alias for probe-with-target return — keeps sig single-line. */
type SubmitProbe = ReturnType<typeof detectOtpSubmit>;

/**
 * Invoke {@link detectOtpSubmit} with the correct arity.
 * @param mediator - Element mediator.
 * @param rawContext - Input probe's `context` field.
 * @returns Procedure-wrapped race result for the submit candidate.
 */
async function invokeOtpSubmitProbe(mediator: IElementMediator, rawContext: RawCtx): SubmitProbe {
  if (rawContext === false) return detectOtpSubmit(mediator).catch(OTP_FALLBACK);
  return detectOtpSubmit(mediator, rawContext).catch(OTP_FALLBACK);
}

/** Promise alias for the submit-form probe. */
type ProbeResult = Promise<IOtpProbeWithTarget>;

/**
 * Probe for the OTP submit button scoped to the (optional) input context.
 * @param args - Bundle of mediator, page, and pipeline logger.
 * @param rawContext - Input-probe's frame context (or false when none).
 * @returns Resolution result + derived submit target.
 */
async function probeOtpSubmitForm(args: IProbeFillArgs, rawContext: RawCtx): ProbeResult {
  const probe = await invokeOtpSubmitProbe(args.mediator, rawContext);
  const result = unwrapProbe(probe);
  traceResolution(args.logger, 'OTP_FILL.PRE submit', result);
  return { result, target: raceResultToTarget(result, args.page) };
}

/**
 * Probe for the OTP-code input + submit button.
 * @param args - Bundle of mediator, page, and pipeline logger.
 * @returns Resolved targets and `found` flags for input + submit.
 */
async function probeOtpFillTargets(args: IProbeFillArgs): Promise<IFillTargetsResult> {
  const inputProbe = await probeOtpInputForm(args);
  const submitProbe = await probeOtpSubmitForm(args, inputProbe.result.context);
  return {
    inputTarget: inputProbe.target,
    submitTarget: submitProbe.target,
    hasInput: inputProbe.result.found,
    hasSubmit: submitProbe.result.found,
  };
}

/**
 * Format the PRE debug line: input/submit found flags + masked hint.
 * @param probes - Probe outcome (input/submit flags).
 * @param phoneHint - Discovered phone-hint digits.
 * @returns Formatted debug message.
 */
function formatFillPreDebug(probes: IFillTargetsResult, phoneHint: string): string {
  const hintLabel = maskVisibleText(phoneHint);
  return `input=${String(probes.hasInput)} submit=${String(probes.hasSubmit)} hint=${hintLabel}`;
}

/** Bundled args for {@link commitFillPre}. */
interface ICommitFillPreArgs {
  readonly page: Page;
  readonly probes: IFillTargetsResult;
  readonly phoneHint: string;
}

/** Bundled inner-args for {@link buildFillPreDiag}. */
interface IFillPreDiagArgs {
  readonly label: string;
  readonly probes: IFillTargetsResult;
  readonly phoneHint: string;
}

/** Shape alias for the PRE diagnostics record. */
type FillPreDiag = IPipelineContext['diagnostics'];

/**
 * Compose the PRE diagnostics record carrying probe outputs.
 * @param input - Pipeline context (for existing diagnostics).
 * @param args - Bundled label + probes + phone hint.
 * @returns New diagnostics record (does NOT mutate input).
 */
function buildFillPreDiag(input: IPipelineContext, args: IFillPreDiagArgs): FillPreDiag {
  const extras: Record<string, unknown> = {
    otpInputTarget: args.probes.inputTarget,
    otpSubmitTarget: args.probes.submitTarget,
    otpPhoneHint: args.phoneHint,
  };
  return { ...input.diagnostics, lastAction: args.label, ...extras };
}

/**
 * Format the canonical PRE `lastAction` label.
 * @param probes - Probe outcome (input/submit found flags).
 * @returns Formatted lastAction label.
 */
function formatFillPreLabel(probes: IFillTargetsResult): string {
  return `otp-fill-pre (input=${String(probes.hasInput)} submit=${String(probes.hasSubmit)})`;
}

/**
 * Compose the PRE-stage diagnostics + emit OTP-FILL with PRE-entry URL.
 * @param input - Pipeline context (for spread).
 * @param args - Bundle of page, probe targets, and phone hint.
 * @returns Succeed with stamped diagnostics + emitted `otpFill`.
 */
function commitFillPre(input: IPipelineContext, args: ICommitFillPreArgs): PreProc {
  const { probes, phoneHint, page } = args;
  const label = formatFillPreLabel(probes);
  const diag = buildFillPreDiag(input, { label, probes, phoneHint });
  const otpFillEmit: IOtpFill = { urlBeforeSubmit: page.url() };
  return succeed({ ...input, diagnostics: diag, otpFill: some(otpFillEmit) });
}

/** Bundled args for the populated-mediator probe path. */
interface IProbeAndCommitArgs {
  readonly input: IPipelineContext;
  readonly mediator: IElementMediator;
  readonly page: Page;
  readonly isRequired: boolean;
}

/** Promise alias keeping executeFillPre sig single-line. */
type FillPreResult = Promise<PreProc>;

/**
 * Run the populated-mediator probe + commit path.
 * @param args - Bundled input/mediator/page/isRequired.
 * @returns Succeed with stamped diagnostics, or missing-input handler.
 */
async function probeAndCommitFillPre(args: IProbeAndCommitArgs): FillPreResult {
  const { input, mediator, page, isRequired } = args;
  const probes = await probeOtpFillTargets({ mediator, page, logger: input.logger });
  if (!probes.hasInput) return handleMissingOtpInput(input, isRequired);
  const phoneHint = await extractDeepPhoneHint(input);
  input.logger.debug({ message: formatFillPreDebug(probes, phoneHint) });
  return commitFillPre(input, { page, probes, phoneHint });
}

/**
 * PRE: Discover OTP code input + submit button — 100% passive.
 * @param input - Pipeline context.
 * @param required - Whether OTP is mandatory (default true).
 * @returns Updated context with input+submit targets in diagnostics.
 */
async function executeFillPre(input: IPipelineContext, required = true): FillPreResult {
  if (!input.mediator.has || !input.browser.has) return succeed(input);
  const mediator = input.mediator.value;
  const page = input.browser.value.page;
  return probeAndCommitFillPre({ input, mediator, page, isRequired: required });
}

export default executeFillPre;
