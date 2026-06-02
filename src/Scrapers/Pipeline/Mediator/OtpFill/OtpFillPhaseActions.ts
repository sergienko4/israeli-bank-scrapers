/**
 * OTP Fill phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    passive — discover code input + submit button via resolveVisible
 * ACTION: executioner — call retriever → fill code → click submit
 * POST:   validate — form error detection + re-probe + screenshot
 * FINAL:  dashboard reveal — cookie re-audit + screenshot
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IOtpFill,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../Elements/ElementMediator.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpError, detectOtpForm, detectOtpSubmit } from '../Form/OtpProbe.js';
import { PHONE_HINT_PATTERN, PHONE_LAST_DIGITS } from '../Otp/OtpDetectorConfig.js';
import { OTP_FALLBACK, readDiagString, readDiagTarget, unwrapProbe } from '../Otp/OtpShared.js';
import { createPromise } from '../Timing/TimingActions.js';
import {
  DEFAULT_OTP_TIMEOUT_MS,
  OTP_PHASE_SETTLE_TIMEOUT_MS,
  OTP_RETRIEVER_SETTLE_MS,
} from '../Timing/TimingConfig.js';

// ── Deep Phone Hint — scan all frames ─────────────────────────────
// PHONE_HINT_PATTERN + PHONE_LAST_DIGITS imported from OtpDetectorConfig
// (CR PR #286 F4 — single source of truth shared with OtpTriggerPhaseActions).

/**
 * Extract phone hint from a single frame's body text.
 * @param frame - Page or Frame to scan.
 * @param frame.evaluate - Playwright evaluate method.
 * @returns Last 3-4 digits or empty.
 */
async function extractHintFromFrame(frame: {
  evaluate: (fn: () => string) => Promise<string>;
}): Promise<string> {
  const bodyText = await frame
    .evaluate((): string => document.body.innerText)
    .catch((): string => '');
  const fullMatch = PHONE_HINT_PATTERN.exec(bodyText);
  if (!fullMatch) return '';
  const digits = PHONE_LAST_DIGITS.exec(fullMatch[0]);
  if (!digits) return '';
  return digits[1];
}

/**
 * Reduce phone hint — short-circuit on first found.
 * @param acc - Accumulated hint promise.
 * @param frame - Current frame.
 * @param frame.evaluate - Playwright evaluate method.
 * @returns First non-empty hint.
 */
function reduceHint(
  acc: Promise<string>,
  frame: { evaluate: (fn: () => string) => Promise<string> },
): Promise<string> {
  return acc.then(async (found): Promise<string> => {
    if (found) return found;
    return extractHintFromFrame(frame);
  });
}

/**
 * Extract phone hint from all frames (main + iframes).
 * @param input - Pipeline context with browser.
 * @returns Last 3-4 digits or empty.
 */
async function extractDeepPhoneHint(input: IPipelineContext): Promise<string> {
  if (!input.browser.has) return '';
  const page = input.browser.value.page;
  const frames = [...page.frames()];
  const seed: Promise<string> = Promise.resolve('');
  return frames.reduce((acc, f): Promise<string> => reduceHint(acc, f), seed);
}

// ── PRE: Discover Code Input + Submit (Rule #20) ──────────────────

/**
 * True when MOCK_MODE is active — lets OTP-PRE short-circuit. Read
 * every call so unit tests can flip the env var per test case
 * (mirrors the AUTH-DISCOVERY pattern in `AuthDiscoveryActions.ts`).
 *
 * @returns Whether MOCK_MODE selects the offline snapshot bypass.
 */
function isMockModeOtpActive(): boolean {
  return process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';
}

/**
 * Build a soft-skip OTP-FILL emit by carrying forward the predecessor
 * URL and stamping a descriptive `lastAction` label. Used by both the
 * MOCK_MODE bypass and the `withOtpFill(required=false)` skip.
 *
 * @param input - Pipeline context.
 * @param label - Diagnostic `lastAction` value (greppable in logs).
 * @returns Succeed with diag + carry-forward emit.
 */
function emitSoftSkipFillPre(input: IPipelineContext, label: string): Procedure<IPipelineContext> {
  const diag = { ...input.diagnostics, lastAction: label };
  const carriedEmit = carryUrlForward(input);
  return succeed({ ...input, diagnostics: diag, otpFill: some(carriedEmit) });
}

/**
 * Optional-skip path: log the soft-skip rationale then emit. Extracted
 * so {@link handleMissingOtpInput} stays a thin dispatcher.
 *
 * @param input - Pipeline context.
 * @returns Soft-skip OTP-FILL emit.
 */
function emitOptionalSkipFillPre(input: IPipelineContext): Procedure<IPipelineContext> {
  input.logger.info({
    message: '>>> OTP input missing — withOtpFill(required=false), soft-skipping OTP-FILL',
  });
  return emitSoftSkipFillPre(input, 'otp-fill-pre (optional-skip)');
}

/**
 * Handle the "OTP input not found" case.
 *
 * <p>M1+ (CI quality hardening) removed the dashboard-reveal fast-path
 * (`isDashboardAlreadyVisible` / `maybeFastPathSuccess`): OTP-FILL no
 * longer imports `probeDashboardReveal` from the Dashboard zone.
 * Dashboard-readiness is owned by AUTH-DISCOVERY (Mission 1, runs after
 * OTP-FILL in the pipeline chain) — `ctx.authDiscovery.dashboardReady`
 * carries the boolean. OTP-FILL with `required=false` and no form found
 * emits the optional-skip diagnostic and succeeds; AUTH-DISCOVERY's
 * downstream probe handles the device-remembered case.
 *
 * @param input - Pipeline context at PRE time.
 * @param required - Whether OTP is mandatory (false soft-skips on miss).
 * @returns Procedure with the appropriate diagnostic stamp.
 */
function handleMissingOtpInput(
  input: IPipelineContext,
  required: boolean,
): Procedure<IPipelineContext> {
  if (isMockModeOtpActive()) return emitSoftSkipFillPre(input, 'otp-fill-pre (mock-bypass)');
  if (!required) return emitOptionalSkipFillPre(input);
  return fail(ScraperErrorTypes.Generic, 'OTP code input not found');
}

/**
 * Build the OTP-FILL emit by COPYING the predecessor's
 * {@link IOtpFill.urlBeforeSubmit} forward (Mission M4.F1 baton).
 * Picks the latest non-empty source: ctx.otpTrigger ⇒ ctx.login.
 * Empty string when neither emitted (test paths only). Used by the
 * soft-skip / MOCK-bypass paths so the next phase always sees a
 * populated `ctx.otpFill`.
 *
 * @param input - Pipeline context (carries the predecessor emit).
 * @returns OTP-FILL emit with the inherited URL.
 */
function carryUrlForward(input: IPipelineContext): IOtpFill {
  if (input.otpTrigger.has) return { urlBeforeSubmit: input.otpTrigger.value.urlBeforeSubmit };
  if (input.login.has) return { urlBeforeSubmit: input.login.value.urlBeforeSubmit };
  return { urlBeforeSubmit: '' };
}

/** Bundled args for {@link probeOtpFillTargets} — keeps params ≤3. */
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

/** Single probe outcome — pairs the raw resolution result with the
 *  optional click target derived from it (RaceResult → IResolvedTarget). */
interface IOtpProbeWithTarget {
  readonly result: IRaceResult;
  readonly target: ReturnType<typeof raceResultToTarget>;
}

/**
 * Probe for the OTP code input via the well-known input patterns,
 * trace the resolution, and convert to a click target.
 *
 * @param args - Bundle of mediator, page, and pipeline logger.
 * @returns Resolution result + derived input target.
 */
async function probeOtpInputForm(args: IProbeFillArgs): Promise<IOtpProbeWithTarget> {
  const probe = await detectOtpForm(args.mediator).catch(OTP_FALLBACK);
  const result = unwrapProbe(probe);
  traceResolution(args.logger, 'OTP_FILL.PRE input', result);
  return { result, target: raceResultToTarget(result, args.page) };
}

/**
 * Invoke {@link detectOtpSubmit} with the correct arity: when no input
 * frame context was discovered we drop the second arg entirely so the
 * probe falls back to the main frame. Keeps the optional `Page | Frame`
 * parameter out of our internal signature (architecture rule forbids
 * returning `undefined`-typed values).
 *
 * @param mediator - Element mediator.
 * @param rawContext - The input probe's `context` field (Page/Frame/false).
 * @returns Procedure-wrapped race result for the submit candidate.
 */
async function invokeOtpSubmitProbe(
  mediator: IElementMediator,
  rawContext: Page | Frame | false,
): ReturnType<typeof detectOtpSubmit> {
  if (rawContext === false) return detectOtpSubmit(mediator).catch(OTP_FALLBACK);
  return detectOtpSubmit(mediator, rawContext).catch(OTP_FALLBACK);
}

/**
 * Probe for the OTP submit button scoped to the (optional) input
 * context, trace the resolution, and convert to a click target.
 *
 * @param args - Bundle of mediator, page, and pipeline logger.
 * @param rawContext - Input-probe's frame context (or false when none).
 * @returns Resolution result + derived submit target.
 */
async function probeOtpSubmitForm(
  args: IProbeFillArgs,
  rawContext: Page | Frame | false,
): Promise<IOtpProbeWithTarget> {
  const probe = await invokeOtpSubmitProbe(args.mediator, rawContext);
  const result = unwrapProbe(probe);
  traceResolution(args.logger, 'OTP_FILL.PRE submit', result);
  return { result, target: raceResultToTarget(result, args.page) };
}

/**
 * Probe for the OTP-code input + submit button via the well-known
 * patterns. Chains the input + submit probes so the submit search
 * inherits the input's frame context.
 *
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
 * Returned as a string so the caller can pass it straight into the
 * logger without growing the orchestrator body.
 *
 * @param probes - Probe outcome (input/submit flags).
 * @param phoneHint - Discovered phone-hint digits.
 * @returns Formatted debug message.
 */
function formatFillPreDebug(probes: IFillTargetsResult, phoneHint: string): string {
  const hintLabel = maskVisibleText(phoneHint);
  return `input=${String(probes.hasInput)} submit=${String(probes.hasSubmit)} hint=${hintLabel}`;
}

/** Bundled args for {@link commitFillPre} — keeps params ≤3. */
interface ICommitFillPreArgs {
  readonly page: Page;
  readonly probes: IFillTargetsResult;
  readonly phoneHint: string;
}

/** Bundled inner-args for {@link buildFillPreDiag} — keeps params ≤3. */
interface IFillPreDiagArgs {
  readonly label: string;
  readonly probes: IFillTargetsResult;
  readonly phoneHint: string;
}

/**
 * Compose the PRE diagnostics record carrying the trigger probe
 * outcome, phone hint, and `lastAction` label. Extracted so the
 * caller's spread/succeed stays under the LoC cap.
 *
 * @param input - Pipeline context (for existing diagnostics).
 * @param args - Bundled label + probes + phone hint.
 * @returns New diagnostics record (does NOT mutate input).
 */
function buildFillPreDiag(
  input: IPipelineContext,
  args: IFillPreDiagArgs,
): IPipelineContext['diagnostics'] {
  const extras: Record<string, unknown> = {
    otpInputTarget: args.probes.inputTarget,
    otpSubmitTarget: args.probes.submitTarget,
    otpPhoneHint: args.phoneHint,
  };
  return { ...input.diagnostics, lastAction: args.label, ...extras };
}

/**
 * Format the canonical PRE `lastAction` label so the long template
 * literal lives in exactly one place (greppable in logs + tests).
 *
 * @param probes - Probe outcome (input/submit found flags).
 * @returns Formatted lastAction label.
 */
function formatFillPreLabel(probes: IFillTargetsResult): string {
  return `otp-fill-pre (input=${String(probes.hasInput)} submit=${String(probes.hasSubmit)})`;
}

/**
 * Compose the PRE-stage diagnostics + emit OTP-FILL with the URL
 * captured at PRE entry (Mission M4.F1 baton). Returned as a single
 * succeed so the orchestrator stays under the cap.
 *
 * @param input - Pipeline context (for spread).
 * @param args - Bundle of page, probe targets, and phone hint.
 * @returns Succeed with stamped diagnostics + emitted `otpFill`.
 */
function commitFillPre(
  input: IPipelineContext,
  args: ICommitFillPreArgs,
): Procedure<IPipelineContext> {
  const { probes, phoneHint, page } = args;
  const label = formatFillPreLabel(probes);
  const diag = buildFillPreDiag(input, { label, probes, phoneHint });
  const otpFillEmit: IOtpFill = { urlBeforeSubmit: page.url() };
  return succeed({ ...input, diagnostics: diag, otpFill: some(otpFillEmit) });
}

/**
 * PRE: Discover OTP code input + submit button — 100% passive.
 * Uses full mediator resolveVisible for post-transition DOM.
 * @param input - Pipeline context.
 * @param required - Whether OTP is mandatory (default true).
 * @returns Updated context with input+submit targets in diagnostics.
 */
async function executeFillPre(
  input: IPipelineContext,
  required = true,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has || !input.browser.has) return succeed(input);
  const mediator = input.mediator.value;
  const page = input.browser.value.page;
  const probes = await probeOtpFillTargets({ mediator, page, logger: input.logger });
  if (!probes.hasInput) return handleMissingOtpInput(input, required);
  const phoneHint = await extractDeepPhoneHint(input);
  input.logger.debug({ message: formatFillPreDebug(probes, phoneHint) });
  return commitFillPre(input, { page, probes, phoneHint });
}

// ── OTP Timeout Watchdog ──────────────────────────────────────────

/** Sentinel for timeout — distinguishes from empty string code. */
const OTP_TIMED_OUT = '__OTP_TIMEOUT__';

/**
 * Race the OTP retriever against a timeout.
 * @param retriever - Consumer callback that returns the OTP code.
 * @param hint - Phone hint to pass to the retriever.
 * @param timeoutMs - Maximum wait time in ms.
 * @returns The OTP code, or false if timed out.
 */
async function raceRetrieverWithTimeout(
  retriever: (hint: string) => Promise<string>,
  hint: string,
  timeoutMs: number,
): Promise<string | false> {
  const timer = createTimeoutPromise(timeoutMs);
  const result = await Promise.race([retriever(hint), timer]);
  if (result === OTP_TIMED_OUT) return false;
  return result;
}

/**
 * Create a promise that resolves to the timeout sentinel after ms.
 * @param ms - Timeout duration.
 * @returns Promise that resolves to OTP_TIMED_OUT.
 */
function createTimeoutPromise(ms: number): Promise<string> {
  return createPromise<string>((resolve): true => {
    globalThis.setTimeout((): true => {
      resolve(OTP_TIMED_OUT);
      return true;
    }, ms);
    return true;
  });
}

// ── ACTION: Fill Code + Submit ────────────────────────────────────

/**
 * Predicate for the optional-skip diagnostic stamp written by PRE.
 *
 * @param input - Sealed action context (carries the PRE diagnostics).
 * @returns True iff PRE marked OTP-FILL as optionally skipped.
 */
function isOtpFillOptionalSkipped(input: IActionContext): boolean {
  return input.diagnostics.lastAction.includes('optional-skip');
}

/**
 * Log the optional-skip honour and pass through unchanged. Extracted
 * so {@link executeFillAction} dispatches in one line.
 *
 * @param input - Sealed action context.
 * @returns Original context untouched.
 */
function honorFillOptionalSkip(input: IActionContext): Procedure<IActionContext> {
  input.logger.debug({ message: 'OTP_FILL.ACTION skipped — optional-skip honored from PRE' });
  return succeed(input);
}

/**
 * Fail-construction helper for the missing-retriever guard.
 *
 * @returns Failed procedure with TwoFactorRetrieverMissing type.
 */
function failOtpRetrieverMissing(): Procedure<IActionContext> {
  return fail(ScraperErrorTypes.TwoFactorRetrieverMissing, 'OTP required but no otpCodeRetriever');
}

/** Bundled args for {@link awaitOtpFromRetriever} — keeps params ≤3. */
interface IRequestCodeArgs {
  readonly retriever: (hint: string) => Promise<string>;
  readonly logger: IPipelineContext['logger'];
  readonly hint: string;
  readonly timeoutMs: number;
}

/**
 * Log the challenge banner then race the user-supplied retriever
 * against the OTP timeout. Returns the raw code or `false` on timeout.
 *
 * @param args - Bundle of retriever, logger, hint, timeout-ms.
 * @returns Resolved code or `false` if the timer wins.
 */
async function awaitOtpFromRetriever(args: IRequestCodeArgs): Promise<string | false> {
  const challenge = `>>> OTP challenge: hint=${args.hint}. Waiting ${String(args.timeoutMs)}ms...`;
  args.logger.info({ message: challenge });
  return raceRetrieverWithTimeout(args.retriever, args.hint, args.timeoutMs);
}

/**
 * Compose the timeout failure with a paired log line, so the caller
 * can `return failOtpTimeout(...)` in one expression.
 *
 * @param logger - Pipeline logger.
 * @param timeoutMs - Configured timeout (ms) for the log line.
 * @returns Failed procedure with the timeout error type.
 */
function failOtpTimeout(
  logger: IPipelineContext['logger'],
  timeoutMs: number,
): Procedure<IActionContext> {
  const msg = `>>> OTP timeout after ${String(timeoutMs)}ms — no code received`;
  logger.info({ message: msg });
  return fail(ScraperErrorTypes.Timeout, 'OTP timeout — code not received');
}

/**
 * Settle the network before invoking the user-supplied retriever so
 * any pre-send XHRs from PRE complete before we start the OTP timer.
 *
 * @param executor - Sealed action mediator.
 * @param logger - Pipeline logger (flushed before the wait).
 * @returns `true` once the settle wait resolves.
 */
async function settleBeforeRetriever(
  executor: IActionMediator,
  logger: IPipelineContext['logger'],
): Promise<true> {
  logger.flush();
  await executor.waitForNetworkIdle(OTP_RETRIEVER_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Drive the retrieve-OTP sub-flow: read hint, settle the network,
 * race the retriever, and surface either the code or a timeout fail.
 *
 * @param input - Sealed action context.
 * @param executor - Sealed action mediator (pre-unwrapped by caller).
 * @param retriever - User-supplied OTP retriever callback.
 * @returns Resolved code string or a fail procedure on timeout.
 */
async function fetchOtpCodeOrFail(
  input: IActionContext,
  executor: IActionMediator,
  retriever: (hint: string) => Promise<string>,
): Promise<string | Procedure<IActionContext>> {
  const hint = readDiagString(input.diagnostics, 'otpPhoneHint');
  await settleBeforeRetriever(executor, input.logger);
  const timeoutMs = input.options.otpTimeoutMs ?? DEFAULT_OTP_TIMEOUT_MS;
  const code = await awaitOtpFromRetriever({ retriever, logger: input.logger, hint, timeoutMs });
  if (!code) return failOtpTimeout(input.logger, timeoutMs);
  input.logger.info({ message: '>>> OTP code received — proceeding to fill' });
  return code;
}

/**
 * Click the optional submit target (after the fill) and log the click.
 * Catches Playwright auto-wait rejects so a missing button never
 * surfaces as an unhandled rejection in tests.
 *
 * @param executor - Sealed action mediator.
 * @param target - Resolved submit target from PRE.
 * @param logger - Pipeline logger for the click-trace.
 * @returns `true` once the click attempt completes.
 */
async function clickOtpSubmitTarget(
  executor: IActionMediator,
  target: IResolvedTarget,
  logger: IPipelineContext['logger'],
): Promise<true> {
  const selRef = { contextId: target.contextId, selector: target.selector };
  await executor.clickElement(selRef).catch((): false => false);
  logger.debug({ message: `clicked ${target.kind}="${target.candidateValue}"` });
  return true;
}

/**
 * Wait for the post-submit settle window then log completion.
 * Centralised so the fill orchestrator stays under the LoC cap.
 *
 * @param executor - Sealed action mediator.
 * @param logger - Pipeline logger.
 * @returns `true` once the settle wait resolves.
 */
async function settleAfterOtpSubmit(
  executor: IActionMediator,
  logger: IPipelineContext['logger'],
): Promise<true> {
  await executor.waitForNetworkIdle(OTP_PHASE_SETTLE_TIMEOUT_MS).catch((): false => false);
  logger.debug({ message: 'submit complete' });
  return true;
}

/**
 * Fill the OTP input with the retrieved code then optionally click
 * the submit button and settle the network. Hand follows Eye — uses
 * exact contextId + selector from PRE.
 *
 * @param input - Sealed action context.
 * @param executor - Sealed action mediator (pre-unwrapped by caller).
 * @param code - Verified OTP code from {@link fetchOtpCodeOrFail}.
 * @returns Updated context on success, or fail if PRE target missing.
 */
async function fillAndSubmitOtpForm(
  input: IActionContext,
  executor: IActionMediator,
  code: string,
): Promise<Procedure<IActionContext>> {
  const inputTarget = readDiagTarget(input.diagnostics, 'otpInputTarget');
  if (!inputTarget) return fail(ScraperErrorTypes.Generic, 'OTP input target missing from PRE');
  await executor.fillInput(inputTarget.contextId, inputTarget.selector, code);
  input.logger.debug({ message: `filled ${inputTarget.kind}="${inputTarget.candidateValue}"` });
  const submitTarget = readDiagTarget(input.diagnostics, 'otpSubmitTarget');
  if (submitTarget) await clickOtpSubmitTarget(executor, submitTarget, input.logger);
  await settleAfterOtpSubmit(executor, input.logger);
  return succeed(input);
}

/**
 * ACTION (sealed): Call retriever → fill code → click submit.
 * Hand follows Eye — uses exact contextId + selector from PRE.
 * @param input - Sealed action context.
 * @returns Updated context or failure.
 */
async function executeFillAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  if (!input.executor.has) return succeed(input);
  if (isOtpFillOptionalSkipped(input)) return honorFillOptionalSkip(input);
  const retriever = input.options.otpCodeRetriever;
  if (!retriever) return failOtpRetrieverMissing();
  const executor = input.executor.value;
  const codeOrFail = await fetchOtpCodeOrFail(input, executor, retriever);
  if (typeof codeOrFail !== 'string') return codeOrFail;
  return fillAndSubmitOtpForm(input, executor, codeOrFail);
}

// ── POST: Validate OTP ────────────────────────────────────────────

/**
 * Fail the POST stage with a masked error message extracted from the
 * detected OTP-error banner. Trace the resolution so forensic logs
 * preserve the matcher hit that triggered the rejection.
 *
 * @param logger - Pipeline logger.
 * @param errorResult - Resolution result from {@link detectOtpError}.
 * @returns Failed procedure with `InvalidOtp` type.
 */
function failOnOtpErrorBanner(
  logger: IPipelineContext['logger'],
  errorResult: Awaited<ReturnType<typeof detectOtpError>>,
): Procedure<IPipelineContext> {
  traceResolution(logger, 'OTP_FILL.POST error', errorResult);
  const msg = maskVisibleText(errorResult.value);
  return fail(ScraperErrorTypes.InvalidOtp, `OTP rejected — ${msg}`);
}

/**
 * Re-probe the OTP form after submit — if it's still visible the bank
 * silently rejected the code. Traces the resolution so the matcher hit
 * is preserved alongside the validation outcome.
 *
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns True iff the OTP form is still present.
 */
async function isOtpFormStillPresent(
  mediator: IElementMediator,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  const mfaResult = unwrapProbe(await detectOtpForm(mediator).catch(OTP_FALLBACK));
  traceResolution(logger, 'OTP_FILL.POST re-probe', mfaResult);
  return mfaResult.found;
}

/**
 * POST: Validate OTP — screenshot + form error detection + re-probe.
 * @param input - Pipeline context.
 * @returns Succeed if accepted, fail if rejected.
 */
async function executeFillPost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  const errorResult = await detectOtpError(mediator);
  if (errorResult.found) return failOnOtpErrorBanner(input.logger, errorResult);
  const isFormStillVisible = await isOtpFormStillPresent(mediator, input.logger);
  if (isFormStillVisible) return fail(ScraperErrorTypes.InvalidOtp, 'OTP form still visible');
  input.logger.debug({ message: 'otp accepted' });
  return succeed(input);
}

// ── FINAL: Dashboard Reveal ───────────────────────────────────────

/**
 * Log the post-final cookie + URL snapshot for forensic observability.
 * Returns a sentinel `true` to satisfy the "no void returns" rule and
 * keep callers concise.
 *
 * @param logger - Pipeline logger.
 * @param cookieCount - Cookie jar size after the OTP-FILL settle.
 * @param currentUrl - Final URL captured at FINAL entry.
 * @returns Sentinel `true`.
 */
function logFillFinalState(
  logger: IPipelineContext['logger'],
  cookieCount: number,
  currentUrl: string,
): true {
  const msg = `cookies=${String(cookieCount)} url=${maskVisibleText(currentUrl)}`;
  logger.debug({ message: msg });
  return true;
}

/**
 * Commit the FINAL diagnostics: stamp `lastAction` with the cookie
 * count so the next phase (AUTH-DISCOVERY) can audit session presence
 * via the diagnostics trail.
 *
 * @param input - Pipeline context.
 * @param cookieCount - Cookies observed after OTP-FILL settle.
 * @returns Succeed with stamped diagnostics.
 */
function commitFillFinalDiag(
  input: IPipelineContext,
  cookieCount: number,
): Procedure<IPipelineContext> {
  const label = `otp-fill-final (cookies=${String(cookieCount)})`;
  const diag = { ...input.diagnostics, lastAction: label };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * FINAL: Prove dashboard loaded — cookie re-audit + screenshot.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
async function executeFillFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeedWithDiag(input, 'otp-fill-final (no mediator)');
  const mediator = input.mediator.value;
  const cookieCount = await countCookies(mediator);
  const currentUrl = mediator.getCurrentUrl();
  logFillFinalState(input.logger, cookieCount, currentUrl);
  return commitFillFinalDiag(input, cookieCount);
}

/**
 * Count session cookies.
 * @param mediator - Element mediator.
 * @returns Cookie count.
 */
async function countCookies(mediator: IElementMediator): Promise<number> {
  const cookies = await mediator.getCookies();
  return cookies.length;
}

/**
 * Succeed with diagnostics stamp.
 * @param input - Pipeline context.
 * @param action - Diagnostic label.
 * @returns Updated context.
 */
function succeedWithDiag(input: IPipelineContext, action: string): Procedure<IPipelineContext> {
  const diag = { ...input.diagnostics, lastAction: action };
  return succeed({ ...input, diagnostics: diag });
}

export {
  DEFAULT_OTP_TIMEOUT_MS,
  executeFillAction,
  executeFillFinal,
  executeFillPost,
  executeFillPre,
};
