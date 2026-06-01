/**
 * INIT phase Mediator actions — browser launch, navigation, validation, wiring.
 * Phase orchestrates ONLY. All logic here.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { installMockContextRoute } from '../../Interceptors/MockInterceptorIO.js';
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
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import createElementMediator from '../Elements/CreateElementMediator.js';
import type { IPreludeSpec } from '../Elements/PagePrelude.js';
import { awaitPagePrelude, probeFirefoxNeterror } from '../Elements/PagePrelude.js';
import {
  ELEMENTS_DOM_READY_TIMEOUT_MS,
  INIT_NAV_COMMIT_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';
import type {
  INavFailedRequest,
  INavInFlightSnapshot,
  INavTransportProbe,
} from './NavigationDiagnostics.js';
import {
  attachFailedRequestCollector,
  attachRequestLifecycleObserver,
  buildNavFailureSnapshot,
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
    const launched = await createContextAndPage(browser);
    await coldStartIfDumping(launched.context);
    await installMockContextRoute(launched.context, input.companyId);
    await setupPage(launched.page, input.options);
    const state = buildBrowserState(launched.page, launched.context, browser);
    return succeed({ ...input, browser: some(state) });
  } catch (error) {
    await closeBrowserSafe(browser);
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `INIT PRE: browser launch failed — ${msg}`);
  }
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
  return runNavigationAttempt(input, page, targetUrl);
}

/**
 * Run the `page.goto` attempt with the failure-collector listener
 * attached for the lifetime of the call. Wraps both timing and the
 * detach-in-finally lifecycle so the public {@link executeNavigateToBank}
 * stays under the 10-line cap and the listeners can never leak.
 *
 * <p>The lifecycle observer (added 2026-06-02) records every request
 * still in-flight at the moment of failure so the snapshot can
 * distinguish "browser never sent a request" from "browser is hung
 * waiting on a response". It is detached in the same finally so the
 * listeners don't leak into the next navigation attempt.
 *
 * @param input - Pipeline context (passed through on success).
 * @param page - Playwright page already validated as present.
 * @param targetUrl - Bank base URL to navigate to.
 * @returns Same context on commit, structured fail on goto error.
 */
async function runNavigationAttempt(
  input: IPipelineContext,
  page: Page,
  targetUrl: string,
): Promise<Procedure<IPipelineContext>> {
  const collector = attachFailedRequestCollector(page);
  const lifecycle = attachRequestLifecycleObserver(page);
  const startMs = Date.now();
  try {
    await page.goto(targetUrl, { waitUntil: 'commit', timeout: INIT_NAV_COMMIT_TIMEOUT_MS });
    return succeed(input);
  } catch (gotoError) {
    const context = collectFailureContext({
      input,
      page,
      error: gotoError as Error,
      startMs,
      failedRequests: collector.collected,
      lifecycle,
    });
    return await handleNavFailure(context, targetUrl);
  } finally {
    collector.detach();
    lifecycle.detach();
  }
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
  const inFlightSnapshot = bundle.lifecycle.snapshot();
  return {
    input: bundle.input,
    page: bundle.page,
    error: bundle.error,
    attemptDurationMs: Date.now() - bundle.startMs,
    failedRequests: bundle.failedRequests,
    inFlightSnapshot,
    finalUrlAtFailure: bundle.page.url(),
    failureTimestampMs: Date.now(),
  };
}

/** Bundle of inputs to {@link collectFailureContext} (`max-params: 3`). */
interface ICollectFailureContextInput {
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly error: Error;
  readonly startMs: number;
  readonly failedRequests: readonly INavFailedRequest[];
  readonly lifecycle: { readonly snapshot: () => INavInFlightSnapshot };
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
  readonly finalUrlAtFailure: string;
  readonly failureTimestampMs: number;
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
  const snapshot = buildNavFailureSnapshot({
    error: inputs.error,
    attemptDurationMs: inputs.attemptDurationMs,
    finalUrl: inputs.finalUrlAtFailure,
    failedRequests: inputs.failedRequests,
  });
  return (
    snapshot.category === 'timeout' &&
    inputs.failedRequests.length === 0 &&
    inputs.finalUrlAtFailure === 'about:blank'
  );
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
  const startedMsAfterGotoFailure = Date.now() - inputs.failureTimestampMs;
  const probe = await probeTransport({
    targetUrl,
    totalBudgetMs: NODE_TRANSPORT_PROBE_BUDGET_MS,
    startedMsAfterGotoFailure,
  });
  return wrapProbeAsOption(probe);
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
  const snapshot = buildNavFailureSnapshot({
    error: inputs.error,
    attemptDurationMs: inputs.attemptDurationMs,
    finalUrl: inputs.finalUrlAtFailure,
    failedRequests: inputs.failedRequests,
    inFlightRequests: inputs.inFlightSnapshot.inFlightRequests,
    inFlightRequestCount: inputs.inFlightSnapshot.inFlightRequestCount,
    inFlightRequestsTruncated: inputs.inFlightSnapshot.inFlightRequestsTruncated,
    nodeTransportProbe,
  });
  logNavFailureSnapshot(inputs.input.logger, snapshot);
  const message = `INIT ACTION: navigation failed — ${toErrorMessage(inputs.error)}`;
  return fail(ScraperErrorTypes.Generic, message);
}

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
  if (currentUrl === 'about:blank') {
    return fail(ScraperErrorTypes.Generic, 'INIT POST: page is blank');
  }
  const probe = await probeFirefoxNeterror(page);
  if (probe.isNeterror) {
    return fail(
      ScraperErrorTypes.Generic,
      `INIT POST: browser error page — title="${probe.title}" url=${maskVisibleText(currentUrl)}`,
    );
  }
  return succeed(input);
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
  if (!wasReady) {
    return fail(ScraperErrorTypes.Generic, 'INIT FINAL: domcontentloaded not observed');
  }
  const fetchStrategy = createBrowserFetchStrategy(page);
  const mediator = createElementMediator(page);
  const loginUrl = page.url();
  const diag = { ...input.diagnostics, loginUrl };
  return succeed({
    ...input,
    fetchStrategy: some(fetchStrategy),
    mediator: some(mediator),
    diagnostics: diag,
  });
}

export { executeLaunchBrowser, executeNavigateToBank, executeValidatePage, executeWireComponents };
