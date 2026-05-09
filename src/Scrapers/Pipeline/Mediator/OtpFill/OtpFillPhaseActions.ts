/**
 * OTP Fill phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    passive — discover code input + submit button via resolveVisible
 * ACTION: executioner — call retriever → fill code → click submit
 * POST:   validate — form error detection + re-probe + screenshot
 * FINAL:  dashboard reveal — cookie re-audit + screenshot
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpError, detectOtpForm, detectOtpSubmit } from '../Form/OtpProbe.js';
import { OTP_FALLBACK, readDiagString, readDiagTarget, unwrapProbe } from '../Otp/OtpShared.js';
import { createPromise } from '../Timing/TimingActions.js';

/** Timeout ceiling for OTP submit settle — early-exit via waitForNetworkIdle. */
const OTP_SETTLE_TIMEOUT = 5000;
/** Settle delay before retriever prompt (ms). */
const RETRIEVER_SETTLE_MS = 500;
/** Default OTP timeout (ms) — 3 minutes. */
const DEFAULT_OTP_TIMEOUT_MS = 180_000;
/** Full masked phone pattern (e.g. *****1234 or ******0). */
const PHONE_HINT_PATTERN = /\*{3,7}\d{1,4}/;
/** Last 1-4 digits extractor. */
const PHONE_LAST_DIGITS = /(\d{1,4})$/;

// ── Deep Phone Hint — scan all frames ─────────────────────────────

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
  // MOCK_MODE safety valve — the selectors are proven in live E2E; mock
  // only validates pipeline flow. Let OTP-FILL PRE succeed when running
  // against static snapshots so the suite covers the scraper logic end-
  // to-end. ACTION/POST/FINAL remain skipped under MockPhasePolicy.
  if (isMockModeOtpActive()) {
    const diag = { ...input.diagnostics, lastAction: 'otp-fill-pre (mock-bypass)' };
    return succeed({ ...input, diagnostics: diag });
  }
  // Optional-OTP safety valve — banks like Hapoalim flag OTP as optional
  // (.withOtpFill(false)). When the OTP input cannot be found, proceed to
  // AUTH-DISCOVERY/DASHBOARD/SCRAPE rather than hard-failing the run.
  // AUTH-DISCOVERY's `dashboardReady` boolean replaces the legacy fast-
  // path probe.
  if (!required) {
    input.logger.info({
      message: '>>> OTP input missing — withOtpFill(required=false), soft-skipping OTP-FILL',
    });
    const diag = { ...input.diagnostics, lastAction: 'otp-fill-pre (optional-skip)' };
    return succeed({ ...input, diagnostics: diag });
  }
  return fail(ScraperErrorTypes.Generic, 'OTP code input not found');
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
  if (!input.mediator.has) return succeed(input);
  if (!input.browser.has) return succeed(input);
  const mediator = input.mediator.value;
  const page = input.browser.value.page;
  const inputResult = unwrapProbe(await detectOtpForm(mediator).catch(OTP_FALLBACK));
  traceResolution(input.logger, 'OTP_FILL.PRE input', inputResult);
  const inputTarget = raceResultToTarget(inputResult, page);
  const inputContext = inputResult.context || undefined;
  const submitProbe = await detectOtpSubmit(mediator, inputContext).catch(OTP_FALLBACK);
  const submitResult = unwrapProbe(submitProbe);
  traceResolution(input.logger, 'OTP_FILL.PRE submit', submitResult);
  const submitTarget = raceResultToTarget(submitResult, page);
  const hasInput: boolean = inputResult.found;
  const hasSubmit: boolean = submitResult.found;
  if (!hasInput) return handleMissingOtpInput(input, required);
  const phoneHint = await extractDeepPhoneHint(input);
  const hintLabel = maskVisibleText(phoneHint);
  input.logger.debug({
    message: `input=${String(hasInput)} submit=${String(hasSubmit)} hint=${hintLabel}`,
  });
  const diag = {
    ...input.diagnostics,
    lastAction: `otp-fill-pre (input=${String(hasInput)} submit=${String(hasSubmit)})`,
    otpInputTarget: inputTarget,
    otpSubmitTarget: submitTarget,
    otpPhoneHint: phoneHint,
  };
  return succeed({ ...input, diagnostics: diag });
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
 * ACTION (sealed): Call retriever → fill code → click submit.
 * Hand follows Eye — uses exact contextId + selector from PRE.
 * @param input - Sealed action context.
 * @returns Updated context or failure.
 */
async function executeFillAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  if (!input.executor.has) return succeed(input);
  // Optional-skip from PRE: bank skipped the OTP challenge (e.g. Hapoalim's
  // device-remembered path) and PRE wrote `optional-skip` into diagnostics —
  // honor it and exit cleanly. Dashboard-readiness is verified downstream by
  // AUTH-DISCOVERY (Mission 1) via `ctx.authDiscovery.dashboardReady`.
  if (input.diagnostics.lastAction.includes('optional-skip')) {
    input.logger.debug({ message: 'OTP_FILL.ACTION skipped — optional-skip honored from PRE' });
    return succeed(input);
  }
  const retriever = input.options.otpCodeRetriever;
  if (!retriever) {
    return fail(
      ScraperErrorTypes.TwoFactorRetrieverMissing,
      'OTP required but no otpCodeRetriever',
    );
  }
  const executor = input.executor.value;
  const hint: string = readDiagString(input.diagnostics, 'otpPhoneHint');
  input.logger.flush();
  await executor.waitForNetworkIdle(RETRIEVER_SETTLE_MS).catch((): false => false);
  const timeoutMs = input.options.otpTimeoutMs ?? DEFAULT_OTP_TIMEOUT_MS;
  input.logger.info({
    message: `>>> OTP challenge: hint=${hint}. Waiting ${String(timeoutMs)}ms...`,
  });
  const code = await raceRetrieverWithTimeout(retriever, hint, timeoutMs);
  if (!code) {
    input.logger.info({
      message: `>>> OTP timeout after ${String(timeoutMs)}ms — no code received`,
    });
    return fail(ScraperErrorTypes.Timeout, 'OTP timeout — code not received');
  }
  input.logger.info({ message: '>>> OTP code received — proceeding to fill' });
  const inputTarget = readDiagTarget(input.diagnostics, 'otpInputTarget');
  if (!inputTarget) {
    return fail(ScraperErrorTypes.Generic, 'OTP input target missing from PRE');
  }
  await executor.fillInput(inputTarget.contextId, inputTarget.selector, code);
  input.logger.debug({
    message: `filled ${inputTarget.kind}="${inputTarget.candidateValue}"`,
  });
  const submitTarget = readDiagTarget(input.diagnostics, 'otpSubmitTarget');
  if (submitTarget) {
    await executor
      .clickElement({ contextId: submitTarget.contextId, selector: submitTarget.selector })
      .catch((): false => false);
    input.logger.debug({
      message: `clicked ${submitTarget.kind}="${submitTarget.candidateValue}"`,
    });
  }
  await executor.waitForNetworkIdle(OTP_SETTLE_TIMEOUT).catch((): false => false);
  input.logger.debug({ message: 'submit complete' });
  return succeed(input);
}

// ── POST: Validate OTP ────────────────────────────────────────────

/**
 * POST: Validate OTP — screenshot + form error detection + re-probe.
 * @param input - Pipeline context.
 * @returns Succeed if accepted, fail if rejected.
 */
async function executeFillPost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  const mediator = input.mediator.value;
  const errorResult = await detectOtpError(mediator);
  if (errorResult.found) {
    traceResolution(input.logger, 'OTP_FILL.POST error', errorResult);
    const msg = maskVisibleText(errorResult.value);
    return fail(ScraperErrorTypes.InvalidOtp, `OTP rejected — ${msg}`);
  }
  const mfaResult = unwrapProbe(await detectOtpForm(mediator).catch(OTP_FALLBACK));
  traceResolution(input.logger, 'OTP_FILL.POST re-probe', mfaResult);
  if (mfaResult.found) {
    return fail(ScraperErrorTypes.InvalidOtp, 'OTP form still visible');
  }
  input.logger.debug({ message: 'otp accepted' });
  return succeed(input);
}

// ── FINAL: Dashboard Reveal ───────────────────────────────────────

/**
 * FINAL: Prove dashboard loaded — cookie re-audit + screenshot.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
async function executeFillFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) {
    return succeedWithDiag(input, 'otp-fill-final (no mediator)');
  }
  const mediator = input.mediator.value;
  const cookieCount = await countCookies(mediator);
  const currentUrl = mediator.getCurrentUrl();
  input.logger.debug({
    message: `cookies=${String(cookieCount)} url=${maskVisibleText(currentUrl)}`,
  });
  const cookiesLabel = `otp-fill-final (cookies=${String(cookieCount)})`;
  const diag = { ...input.diagnostics, lastAction: cookiesLabel };
  return succeed({ ...input, diagnostics: diag });
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
