/**
 * INIT phase Mediator actions — browser launch, navigation, validation, wiring.
 * Phase orchestrates ONLY. All logic here.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  buildBrowserState,
  closeBrowserSafe,
  createContextAndPage,
  launchBrowser,
  setupPage,
} from '../../Phases/Init/InitBrowserSetup.js';
import { createBrowserFetchStrategy } from '../../Strategy/Fetch/BrowserFetchStrategy.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { INeterrorProbeResult } from '../Browser/BrowserErrorPage.js';
import createElementMediator from '../Elements/CreateElementMediator.js';
import type { IPreludeSpec } from '../Elements/PagePrelude.js';
import { awaitPagePrelude, probeFirefoxNeterror } from '../Elements/PagePrelude.js';
import {
  ELEMENTS_DOM_READY_TIMEOUT_MS,
  INIT_NAV_COMMIT_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';
import { logEnvSnapshot } from './EnvSnapshot.js';
import type {
  IConsoleErrorBuffer,
  IConsoleErrorEntry,
  IFailedRequestCollector,
  IFrameInfo,
  ILandingResponseCollector,
  INavFailedRequest,
  INavFailureInput,
  INavFailureSnapshot,
  INavInFlightSnapshot,
  INavTransportProbe,
  IProbeRunInput,
  IRequestLifecycleObserver,
  IResponseInfo,
} from './NavigationDiagnostics.js';
import {
  attachConsoleErrorBuffer,
  attachFailedRequestCollector,
  attachLandingResponseCollector,
  attachRequestLifecycleObserver,
  buildNavFailureSnapshot,
  captureFrameTree,
  classifyNavError,
  logNavFailureSnapshot,
  probeTransport,
  wrapProbeAsOption,
} from './NavigationDiagnostics.js';

/**
 * Cold-Start protocol — when DUMP_SNAPSHOTS=1, strip every cookie so
 * device-remembered banks (Hapoalim) present the full OTP challenge.
 * Needed to capture a high-fidelity otp-fill.html with PIN inputs visible.
 * @param context - Browser context to sanitise.
 * @returns True when DUMP_SNAPSHOTS was active and cookies were cleared,
 * false when the dump flag was off and the call was a no-op.
 */
async function coldStartIfDumping(context: BrowserContext): Promise<boolean> {
  const isDumping = process.env.DUMP_SNAPSHOTS === '1' || process.env.DUMP_SNAPSHOTS === 'true';
  if (!isDumping) return false;
  await context.clearCookies().catch((): false => false);
  return true;
}

/**
 * PRE: Launch browser, create page, wire browser state into context.
 * Applies Cold-Start + mock route install before navigation.
 * @param input - Pipeline context with options.
 * @returns Updated context with browser state, or failure.
 */
async function executeLaunchBrowser(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  let browser: Browser | false = false;
  try {
    browser = await launchBrowser(input.options);
    return await buildSuccessfulLaunch(input, browser);
  } catch (error) {
    return failLaunch(browser, error as Error);
  }
}

/** Bundle returned by {@link createContextAndPage} — context + page handles. */
interface ILaunchedPage {
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * Apply the post-launch Cold-Start scrub and page-level setup in one
 * call. Pulled out of {@link buildSuccessfulLaunch} so the success-path
 * stays ≤10 LoC.
 *
 * @param launched - Context + page returned from {@link createContextAndPage}.
 * @param input - Pipeline context (carries companyId + options).
 * @returns `true` (no-void rule).
 */
async function applyPostLaunchSetup(
  launched: ILaunchedPage,
  input: IPipelineContext,
): Promise<boolean> {
  await coldStartIfDumping(launched.context);
  await setupPage(launched.page, input.options);
  return true;
}

/**
 * Build the successful-launch procedure — create context + page, run
 * post-launch setup, wire the browser state into the pipeline ctx.
 *
 * @param input - Pipeline context with options + companyId.
 * @param browser - The launched browser handle.
 * @returns Pipeline context with `browser` populated.
 */
async function buildSuccessfulLaunch(
  input: IPipelineContext,
  browser: Browser,
): Promise<Procedure<IPipelineContext>> {
  const launched = await createContextAndPage(browser);
  await applyPostLaunchSetup(launched, input);
  await logEnvSnapshot({ browser, page: launched.page, logger: input.logger });
  const state = buildBrowserState(launched.page, launched.context, browser);
  return succeed({ ...input, browser: some(state) });
}

/**
 * Close the browser (best-effort) and return a structured `fail`
 * carrying the original launch error message. Pulled out of
 * {@link executeLaunchBrowser} so the try/catch shell stays ≤10 LoC.
 *
 * @param browser - Browser handle if launch had progressed (may be `false`).
 * @param error - Error caught from `launchBrowser` or subsequent setup.
 * @returns `Procedure` failure with `ScraperErrorTypes.Generic`.
 */
async function failLaunch(browser: Browser | false, error: Error): Promise<IProcedureFailure> {
  await closeBrowserSafe(browser);
  const msg = toErrorMessage(error);
  return fail(ScraperErrorTypes.Generic, `INIT PRE: browser launch failed — ${msg}`);
}

/**
 * ACTION: Open the bank's base URL — fires the navigation. Uses
 * Playwright's lightest lifecycle event (`'commit'`) so this stage
 * returns the moment the server responds with the first byte
 * (TLS done + HTTP headers received). HTML parsing and `load`
 * happen in subsequent stages.
 *
 * <p>ZERO dependency on other INIT functions. Reads `input.browser`
 * + `input.config.urls.base` only; emits no new ctx field — the
 * navigation is a side effect on the page, validated by POST.
 *
 * <p>On failure, emits a structured `warn` log via
 * {@link "./NavigationDiagnostics.js" logNavFailureSnapshot} with
 * `category` (timeout/dns/tcp-refused/tcp-reset/tls/unknown),
 * `attemptDurationMs`, `finalUrl`, and any failed sub-requests.
 * The returned `Procedure` contract is unchanged: still a
 * `ScraperErrorTypes.Generic` fail with the same message format
 * so callers don't have to branch on the new telemetry.
 *
 * @param input - Pipeline context with browser + config.
 * @returns Same context after the commit lands, or failure.
 */
async function executeNavigateToBank(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT ACTION: no browser');
  const page = input.browser.value.page;
  const targetUrl = input.config.urls.base;
  input.logger.debug({ url: maskVisibleText(targetUrl), didNavigate: false });
  return runNavigationAttempt({ input, page, targetUrl });
}

/**
 * Run the `page.goto` attempt with both failure-collector and
 * lifecycle observer attached for the lifetime of the call. Wraps
 * the timing handle, detach-in-finally lifecycle, and the catch-side
 * failure-context capture so {@link executeNavigateToBank} stays
 * trivially small and listeners can never leak onto the page.
 *
 * @param bundle - Pipeline context + page + target URL (reused `INavCommitInput`).
 * @returns Same context on commit, structured fail on goto error.
 */
async function runNavigationAttempt(bundle: INavCommitInput): Promise<Procedure<IPipelineContext>> {
  const observers = attachNavObservers(bundle.page);
  try {
    return await navigateAndCommit(bundle);
  } catch (error) {
    return await handleGotoRejection({ ...bundle, observers, error: error as Error });
  } finally {
    detachNavObservers(observers);
  }
}

/** Bundle returned by {@link attachNavObservers}. */
interface INavObservers {
  readonly collector: IFailedRequestCollector;
  readonly lifecycle: IRequestLifecycleObserver;
  readonly consoleBuffer: IConsoleErrorBuffer;
  readonly landingCollector: ILandingResponseCollector;
  readonly startMs: number;
}

/**
 * Attach the failed-request collector, lifecycle observer, L7
 * console buffer, and L7 landing-response collector to the page in
 * one call, returning a single handle the caller can detach in a
 * `finally` block. Captures the start timestamp so the failure
 * snapshot can report attempt duration without a second `Date.now()`.
 *
 * @param page - Playwright page to observe.
 * @returns Observer handle + collectors + start timestamp.
 */
function attachNavObservers(page: Page): INavObservers {
  return {
    collector: attachFailedRequestCollector(page),
    lifecycle: attachRequestLifecycleObserver(page),
    consoleBuffer: attachConsoleErrorBuffer(page),
    landingCollector: attachLandingResponseCollector(page),
    startMs: Date.now(),
  };
}

/**
 * Detach all four observers from the page. Idempotent; safe to call
 * in the `finally` block of {@link runNavigationAttempt} on every
 * code path — success, failure, or thrown exception.
 *
 * @param observers - Handle returned by {@link attachNavObservers}.
 * @returns `true` (no-void rule).
 */
function detachNavObservers(observers: INavObservers): boolean {
  observers.collector.detach();
  observers.lifecycle.detach();
  observers.consoleBuffer.detach();
  observers.landingCollector.detach();
  return true;
}

/** Bundle of inputs to {@link navigateAndCommit} (`max-params: 3`). */
interface INavCommitInput {
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly targetUrl: string;
}

/**
 * Run a single `page.goto` to commit. Extracted from
 * {@link runNavigationAttempt} so the try block has exactly one
 * awaited operation and the rejection is forwarded to the catch
 * cleanly via `return await`.
 *
 * @param bundle - Context + page + bank URL to navigate to.
 * @returns Same context on commit, never returns on rejection (throws).
 */
async function navigateAndCommit(bundle: INavCommitInput): Promise<Procedure<IPipelineContext>> {
  await bundle.page.goto(bundle.targetUrl, {
    waitUntil: 'commit',
    timeout: INIT_NAV_COMMIT_TIMEOUT_MS,
  });
  return succeed(bundle.input);
}

/** Bundle of inputs to {@link handleGotoRejection} (`max-params: 3`). */
interface IGotoRejectionInput {
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly targetUrl: string;
  readonly observers: INavObservers;
  readonly error: Error;
}

/**
 * Capture the failure context synchronously from the catch and then
 * await the post-failure probe / log envelope. Pulled out so the
 * `try / catch / finally` skeleton in {@link runNavigationAttempt}
 * stays under the 10-line cap.
 *
 * @param bundle - Context + page + bank URL + observers + goto error.
 * @returns Structured fail procedure for the navigation failure.
 */
async function handleGotoRejection(
  bundle: IGotoRejectionInput,
): Promise<Procedure<IPipelineContext>> {
  const ctxInput = buildFailureContextInput(bundle);
  const context = collectFailureContext(ctxInput);
  return handleNavFailure(context, bundle.targetUrl);
}

/**
 * Project the observer-derived fields of {@link ICollectFailureContextInput}
 * — extracted to keep {@link buildFailureContextInput} ≤10 LoC.
 *
 * @param observers - Live navigation observers bundle.
 * @returns The 5 observer-sourced fields of the failure-context bundle.
 */
function projectObserverFields(observers: INavObservers): IObservedFields {
  return {
    startMs: observers.startMs,
    failedRequests: observers.collector.collected,
    lifecycle: observers.lifecycle,
    consoleBuffer: observers.consoleBuffer,
    landingCollector: observers.landingCollector,
  };
}

/**
 * Re-shape an {@link IGotoRejectionInput} into the
 * {@link ICollectFailureContextInput} carrier consumed by
 * {@link collectFailureContext} — addresses CodeRabbit R3-1 and keeps
 * {@link handleGotoRejection} ≤10 LoC.
 *
 * @param bundle - Goto-rejection bundle (context + page + observers + error).
 * @returns Bundle ready for synchronous failure-context capture.
 */
function buildFailureContextInput(bundle: IGotoRejectionInput): ICollectFailureContextInput {
  const refs = { input: bundle.input, page: bundle.page, error: bundle.error };
  const observed = projectObserverFields(bundle.observers);
  return { ...refs, ...observed };
}

/**
 * Snapshot the failure context (in-flight + final URL + timing)
 * IMMEDIATELY in the catch block — BEFORE awaiting the post-failure
 * probe — so the captured state reflects the moment of failure, not
 * the network state 5 seconds later. Pure read; no awaits.
 *
 * @param bundle - All inputs needed to assemble the failure context.
 * @returns Failure context bundle for {@link handleNavFailure}.
 */
function collectFailureContext(bundle: ICollectFailureContextInput): IHandleNavFailureInput {
  const now = Date.now();
  const inFlight = bundle.lifecycle.snapshot();
  return assembleFailureInput(bundle, now, inFlight);
}

/**
 * Combine the flight-state + L7 forensic fields into a single
 * partial — extracted to keep {@link assembleFailureInput} ≤10 LoC.
 *
 * @param bundle - The failure-context input bundle.
 * @param inFlight - In-flight snapshot from the lifecycle observer.
 * @returns Combined flight + L7 partial.
 */
function buildFlightL7Fields(
  bundle: ICollectFailureContextInput,
  inFlight: INavInFlightSnapshot,
): IFlightL7Fields {
  const flight = { inFlightSnapshot: inFlight, finalUrl: bundle.page.url() };
  const l7 = captureL7State(bundle);
  return { ...flight, ...l7 };
}

/**
 * Assemble the {@link IHandleNavFailureInput} carrier from the input
 * bundle + the timestamp + the in-flight snapshot captured in the
 * catch. Addresses CodeRabbit R3-3 — keeps {@link collectFailureContext}
 * ≤10 LoC by splitting "snapshot" from "carrier assembly".
 *
 * @param bundle - The pre-snapshot inputs (context + page + error + start).
 * @param now - `Date.now()` captured at the entry to the catch.
 * @param inFlight - In-flight snapshot from the lifecycle observer.
 * @returns Bundle ready for {@link handleNavFailure}.
 */
function assembleFailureInput(
  bundle: ICollectFailureContextInput,
  now: number,
  inFlight: INavInFlightSnapshot,
): IHandleNavFailureInput {
  const refs = { input: bundle.input, page: bundle.page, error: bundle.error };
  const timing = { attemptDurationMs: now - bundle.startMs, failureTimestampMs: now };
  const flightL7 = buildFlightL7Fields(bundle, inFlight);
  return { ...refs, ...timing, ...flightL7, failedRequests: bundle.failedRequests };
}

/** Bundle of inputs to {@link collectFailureContext} (`max-params: 3`). */
interface ICollectFailureContextInput {
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly error: Error;
  readonly startMs: number;
  readonly failedRequests: readonly INavFailedRequest[];
  readonly lifecycle: { readonly snapshot: () => INavInFlightSnapshot };
  readonly consoleBuffer: IConsoleErrorBuffer;
  readonly landingCollector: ILandingResponseCollector;
}

/**
 * Inputs to {@link handleNavFailure}. Bundled to satisfy the
 * `max-params: 3` rule. All fields are captured BEFORE the
 * post-failure probe is awaited so the bundle reflects the moment
 * of failure, not the post-probe state.
 */
interface IHandleNavFailureInput {
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly error: Error;
  readonly attemptDurationMs: number;
  readonly failedRequests: readonly INavFailedRequest[];
  readonly inFlightSnapshot: INavInFlightSnapshot;
  readonly finalUrl: string;
  readonly failureTimestampMs: number;
  readonly frameTree: readonly IFrameInfo[];
  readonly consoleErrors: readonly IConsoleErrorEntry[];
  readonly landingResponse: Option<IResponseInfo>;
}

/** L7 state captured synchronously by {@link captureL7State}. */
interface IL7State {
  readonly frameTree: readonly IFrameInfo[];
  readonly consoleErrors: readonly IConsoleErrorEntry[];
  readonly landingResponse: Option<IResponseInfo>;
}

/** Observer-derived fields of {@link ICollectFailureContextInput}. */
interface IObservedFields {
  readonly startMs: number;
  readonly failedRequests: readonly INavFailedRequest[];
  readonly lifecycle: { readonly snapshot: () => INavInFlightSnapshot };
  readonly consoleBuffer: IConsoleErrorBuffer;
  readonly landingCollector: ILandingResponseCollector;
}

/** Combined flight + L7 fields returned by {@link buildFlightL7Fields}. */
interface IFlightL7Fields extends IL7State {
  readonly inFlightSnapshot: INavInFlightSnapshot;
  readonly finalUrl: string;
}

/**
 * Capture the L7 forensic state from the live page + the buffered
 * observer handles. Pure synchronous reads — the page is still alive
 * at this point (the catch block has not yet awaited anything).
 *
 * @param bundle - Failure-context bundle with page + observer handles.
 * @returns L7 state snapshot.
 */
function captureL7State(bundle: ICollectFailureContextInput): IL7State {
  return {
    frameTree: captureFrameTree(bundle.page),
    consoleErrors: bundle.consoleBuffer.collected,
    landingResponse: bundle.landingCollector.getResponse(),
  };
}

/**
 * Wall-clock budget (ms) for the Node-level transport probe run on
 * the failure path. Bounded so the post-failure path never extends
 * the INIT phase by more than {@link NODE_TRANSPORT_PROBE_BUDGET_MS}
 * even when every probe phase times out.
 */
const NODE_TRANSPORT_PROBE_BUDGET_MS = 5000;

/**
 * Decide whether the failure fingerprint warrants the Node transport
 * probe. Only the ambiguous case ({@link runNavigationAttempt} timed
 * out with no failed sub-requests and no committed URL) benefits —
 * other categories already carry their own diagnostic signal.
 *
 * @param inputs - The failure context bundle.
 * @returns True when the probe should run.
 */
function shouldRunTransportProbe(inputs: IHandleNavFailureInput): boolean {
  if (inputs.failedRequests.length !== 0) return false;
  if (inputs.finalUrl !== 'about:blank') return false;
  const message = toErrorMessage(inputs.error);
  return classifyNavError(message) === 'timeout';
}

/**
 * Run the transport probe when the failure fingerprint is ambiguous,
 * otherwise return `none()`. Always swallows probe errors via the
 * always-resolves contract of {@link probeTransport}.
 *
 * @param inputs - The failure context bundle.
 * @param targetUrl - Bank base URL that was being navigated to.
 * @returns Option of probe result; `none()` when the probe was not run.
 */
async function maybeRunTransportProbe(
  inputs: IHandleNavFailureInput,
  targetUrl: string,
): Promise<Option<INavTransportProbe>> {
  if (!shouldRunTransportProbe(inputs)) return none();
  const runInput = buildProbeRunInput(inputs, targetUrl);
  const probe = await probeTransport(runInput);
  return wrapProbeAsOption(probe);
}

/**
 * Build the {@link IProbeRunInput} bundle from the failure context.
 * Extracted so {@link maybeRunTransportProbe} fits the 10-LoC cap.
 *
 * @param inputs - The failure context bundle.
 * @param targetUrl - Bank base URL.
 * @returns Probe run input with `startedMsAfterGotoFailure` computed.
 */
function buildProbeRunInput(inputs: IHandleNavFailureInput, targetUrl: string): IProbeRunInput {
  return {
    targetUrl,
    totalBudgetMs: NODE_TRANSPORT_PROBE_BUDGET_MS,
    startedMsAfterGotoFailure: Date.now() - inputs.failureTimestampMs,
  };
}

/**
 * Emit the structured failure snapshot and return the fail result.
 * Runs the optional Node transport probe (gated to the ambiguous
 * timeout fingerprint) and bundles its result into the snapshot, then
 * emits a single `INIT-ACTION-NAV-FAILURE` warn line.
 *
 * @param inputs - Bundled context, page, error, timing, sub-request snapshot.
 * @param targetUrl - Bank base URL (for the transport probe).
 * @returns Fail procedure with `ScraperErrorTypes.Generic`.
 */
async function handleNavFailure(
  inputs: IHandleNavFailureInput,
  targetUrl: string,
): Promise<Procedure<IPipelineContext>> {
  const nodeTransportProbe = await maybeRunTransportProbe(inputs, targetUrl);
  const snapshot = buildSnapshotFromInputs(inputs, nodeTransportProbe);
  logNavFailureSnapshot(inputs.input.logger, snapshot);
  const message = `INIT ACTION: navigation failed — ${toErrorMessage(inputs.error)}`;
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Re-assemble the {@link buildNavFailureSnapshot} input bundle from
 * the {@link IHandleNavFailureInput} carrier — extracted so
 * {@link handleNavFailure} stays under the 10-line cap and the
 * snapshot field mapping is in one audit point.
 *
 * @param inputs - Failure context bundle captured at the catch.
 * @param nodeTransportProbe - Optional probe result attached to the snapshot.
 * @returns Structured failure snapshot ready for `logger.warn`.
 */
function buildSnapshotFromInputs(
  inputs: IHandleNavFailureInput,
  nodeTransportProbe: Option<INavTransportProbe>,
): INavFailureSnapshot {
  const fields = mapInputsToSnapshotFields(inputs, inputs.inFlightSnapshot, nodeTransportProbe);
  return buildNavFailureSnapshot(fields);
}

/**
 * Map the {@link IHandleNavFailureInput} carrier + the in-flight
 * snapshot + the optional probe into the {@link INavFailureInput}
 * shape consumed by {@link buildNavFailureSnapshot}. Addresses
 * CodeRabbit R3-2 by isolating the field mapping in one audit point.
 *
 * @param inputs - Failure context bundle captured at the catch.
 * @param snap - In-flight snapshot (already destructured by the caller).
 * @param nodeTransportProbe - Optional probe result attached to the snapshot.
 * @returns Field bundle ready for {@link buildNavFailureSnapshot}.
 */
function mapInputsToSnapshotFields(
  inputs: IHandleNavFailureInput,
  snap: INavInFlightSnapshot,
  nodeTransportProbe: Option<INavTransportProbe>,
): INavFailureInput {
  const { error, attemptDurationMs, finalUrl, failedRequests } = inputs;
  const { frameTree, consoleErrors, landingResponse } = inputs;
  const l7 = { frameTree, consoleErrors, landingResponse };
  return { error, attemptDurationMs, finalUrl, failedRequests, ...snap, ...l7, nodeTransportProbe };
}

/**
 * Centralised failure messages for the validate/wire post-launch
 * gates. Promoted to module-level constants so the inline `if`
 * returns fit ≤100 chars without splitting (which would push the
 * host functions over the 10-LoC cap).
 */
const VALIDATE_BLANK_MSG = 'INIT POST: page is blank';
const WIRE_NO_DOM_MSG = 'INIT FINAL: domcontentloaded not observed';

/**
 * POST: Validate the navigation committed — page URL is no longer
 * `about:blank` AND the page is not Firefox's neterror chrome.
 * Pure observation: reads URL + title, zero clicks, zero WK lookup.
 * The commit wait already happened in ACTION; POST is the sanity
 * gate that confirms a real bank page (not a browser error page)
 * landed.
 *
 * <p>PR #221 review-fix session 2026-05-11 added the title-based
 * neterror gate via {@link probeFirefoxNeterror}. Without it, a
 * cold-start DNS / TCP failure cascaded silently through INIT →
 * HOME → LOGIN and surfaced 25-30s later at AUTH-DISCOVERY.FINAL
 * as `reveal-missing` — wasting Phase 5 wall time AND obscuring the
 * actual failure point. The title check fails-loud immediately with
 * a descriptive message so retry logic (or human re-runs) can target
 * the real cause.
 *
 * <p>ZERO dependency on other INIT functions. Reads `input.browser`
 * only; emits no new ctx field. `page.title()` rejections are
 * absorbed inside the helper — the gate is observability-only and
 * must never crash POST on a transient `evaluate` failure.
 *
 * @param input - Pipeline context with browser.
 * @returns Succeed when URL committed AND title not a Firefox
 *   neterror page; fail when blank URL or neterror title detected.
 */
async function executeValidatePage(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT POST: no browser');
  const page = input.browser.value.page;
  const currentUrl = page.url();
  input.logger.debug({ url: maskVisibleText(currentUrl) });
  if (currentUrl === 'about:blank') return fail(ScraperErrorTypes.Generic, VALIDATE_BLANK_MSG);
  const probe = await probeFirefoxNeterror(page);
  if (probe.isNeterror) return buildNeterrorFail(probe, currentUrl);
  return succeed(input);
}

/**
 * Build the structured `fail` for the Firefox neterror branch of
 * {@link executeValidatePage}. Pulled out so the validate host stays
 * ≤10 LoC and the neterror message format lives in one audit point.
 *
 * @param probe - Result of {@link probeFirefoxNeterror} (carries `title`).
 * @param currentUrl - URL at the moment the neterror was detected.
 * @returns Failure `Procedure` describing the browser error page.
 */
function buildNeterrorFail(probe: INeterrorProbeResult, currentUrl: string): IProcedureFailure {
  const detail = `title="${probe.title}" url=${maskVisibleText(currentUrl)}`;
  return fail(ScraperErrorTypes.Generic, `INIT POST: browser error page — ${detail}`);
}

/**
 * INIT.FINAL prelude spec — DOM-ready ceiling for the post-launch
 * wait before wiring fetchStrategy + mediator. Migrated to the
 * centralised {@link "../Elements/PagePrelude.js"} helper so
 * lifecycle waits live behind a single audit point.
 */
const INIT_FINAL_PRELUDE: IPreludeSpec = { level: 'dom', timeoutMs: ELEMENTS_DOM_READY_TIMEOUT_MS };

/**
 * FINAL: Validate the DOM finished parsing
 * (`page.waitForLoadState('domcontentloaded')`), then wire
 * `fetchStrategy` + `mediator` + `diagnostics.loginUrl` so HOME
 * has its inputs. Uses {@link INIT_DOM_READY_TIMEOUT_MS} (10 s);
 * fails loud when the page never reaches DOMContentLoaded.
 *
 * <p>We deliberately do NOT wait for the `load` event — empirical
 * Camoufox probe (2026-05-10) showed half the browser-flow banks
 * (max / amex / isracard) take 12–15 s to fire `load` because
 * marketing / analytics scripts gate it. The framework never
 * reads `window.onload`, so waiting for it adds latency without
 * value. `domcontentloaded` is the right "page is usable" signal.
 *
 * <p>ZERO HTML scanning — `awaitPagePrelude` is a browser-event
 * listener, not a DOM query. ZERO dependency on other INIT
 * functions. Reads `input.browser` + `input.diagnostics`; emits
 * the new fields above.
 *
 * @param input - Pipeline context with browser.
 * @returns Updated context with mediator + fetchStrategy, or fail.
 */
async function executeWireComponents(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT FINAL: no browser');
  const page = input.browser.value.page;
  const wasReady = await awaitPagePrelude(input, INIT_FINAL_PRELUDE);
  if (!wasReady) return fail(ScraperErrorTypes.Generic, WIRE_NO_DOM_MSG);
  const wired = buildWiredContext(input, page);
  return succeed(wired);
}

/**
 * Build the wired pipeline context — `fetchStrategy`, `mediator`,
 * and `diagnostics.loginUrl` from the live page. Pulled out so
 * {@link executeWireComponents} stays ≤10 LoC.
 *
 * @param input - Pipeline context with browser (caller already validated).
 * @param page - Playwright page handle.
 * @returns Updated pipeline context with FINAL fields populated.
 */
function buildWiredContext(input: IPipelineContext, page: Page): IPipelineContext {
  const fetchStrategy = createBrowserFetchStrategy(page);
  const mediator = createElementMediator(page, input.logger);
  const diagnostics = { ...input.diagnostics, loginUrl: page.url() };
  return { ...input, fetchStrategy: some(fetchStrategy), mediator: some(mediator), diagnostics };
}

export { executeLaunchBrowser, executeNavigateToBank, executeValidatePage, executeWireComponents };
