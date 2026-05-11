/**
 * Phase-aware page-readiness prelude — single audit point for the
 * lifecycle wait every navigating phase needs before its DOM probe
 * or click.
 *
 * <p>Replaces the scattered direct calls to `waitForLoadState` /
 * `waitForDomReady` with a declarative spec that callers (typically
 * {@link "../../Types/BasePhase.js"} `BasePhase.runStage`) thread
 * through. Each call emits a canonical telemetry line so post-run
 * `pipeline.log` analysis can attribute slow runs to the exact stage
 * paying the prelude budget.
 *
 * <p>Two levels:
 * <ul>
 *   <li>`'dom'` — calls {@link waitForDomReady}. The page's HTML parser
 *       has finished. Adequate for resolvers and fills on already-loaded
 *       pages (PRE-LOGIN.PRE, LOGIN.PRE, OTP-FILL.PRE).</li>
 *   <li>`'spa'` — calls {@link waitForSpaReady}. The `load` event fired
 *       AND the network has been quiet for 500 ms. Adequate for stages
 *       firing clicks on SPA-rendered targets whose event handlers bind
 *       asynchronously (HOME.ACTION, DASHBOARD.ACTION, LOGIN.POST).</li>
 *   <li>`'none'` — short-circuit. No wait. Used for stages that don't
 *       touch the DOM (FINAL emits, network-only POSTs).</li>
 * </ul>
 *
 * <p>The helper short-circuits unconditionally when {@link isMockTimingActive}
 * is true (MOCK_MODE=1): mock fixtures have no real browser lifecycle and
 * `waitForLoadState` would hang.
 *
 * <p>Failure mode: returns false on timeout / no-page-available. The
 * caller's own probe (resolveVisible / click / etc.) is the source of
 * truth — prelude is a hint to maximise probe success, not a gate.
 */

import type { Frame, Page } from 'playwright-core';

import { getActivePhase, getActiveStage } from '../../Types/ActiveState.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { isMockTimingActive } from '../../Types/Debug.js';
import type { Option } from '../../Types/Option.js';
import { PRELUDE_NONE_BUDGET_MS } from '../Timing/TimingConfig.js';
import { waitForDomReady, waitForSpaReady } from './PageReadiness.js';

/** Closed enum of readiness levels — matches the OCP pattern used by AuthDiscoveryFailCode. */
type PreludeLevel = 'none' | 'dom' | 'spa';

/** Declarative prelude specification — what level and how long to wait. */
interface IPreludeSpec {
  readonly level: PreludeLevel;
  readonly timeoutMs: number;
}

/**
 * Sentinel for "no prelude required". Default returned by
 * {@link "../../Types/BasePhase.js"} `BasePhase.prelude` so phases
 * inherit the no-op without per-stage overrides. Budget value is
 * centralised in `TimingConfig.PRELUDE_NONE_BUDGET_MS`.
 */
const PRELUDE_NONE: IPreludeSpec = { level: 'none', timeoutMs: PRELUDE_NONE_BUDGET_MS };

/**
 * Minimal browser-state interface — any pipeline / action / bootstrap
 * context that holds an optional Playwright page satisfies this shape.
 * Structural typing keeps {@link awaitPagePrelude} usable from every
 * stage without union types.
 */
interface IBrowserStateLike {
  readonly page: Page;
}

/** Minimal context shape the prelude needs — browser + logger. */
interface IPreludeContext {
  readonly browser: Option<IBrowserStateLike>;
  readonly logger: ScraperLogger;
}

/** Readiness target — Playwright Page or Frame. Both expose `waitForLoadState`. */
type ReadinessTarget = Page | Frame;

/**
 * Short-circuit handler for `'none'` level — resolves true without
 * touching the target. Used when a stage opts out of any wait.
 *
 * @returns Promise resolving to true.
 */
function handleNonePrelude(): Promise<boolean> {
  return Promise.resolve(true);
}

/**
 * DOM-level handler — delegates to {@link waitForDomReady}. Used by
 * stages that only need the HTML parser to have finished. Accepts
 * Page or Frame; iframe-hosted login forms (LOGIN.PRE on hapoalim-
 * group banks) need this on the Frame, not the parent Page.
 *
 * @param target - Active Playwright page or frame.
 * @param timeoutMs - Wait budget in milliseconds.
 * @returns Promise resolving to true when `domcontentloaded` fired.
 */
function handleDomPrelude(target: ReadinessTarget, timeoutMs: number): Promise<boolean> {
  return waitForDomReady(target, timeoutMs);
}

/**
 * SPA-level handler — delegates to {@link waitForSpaReady}. Used by
 * stages that fire clicks (HOME / DASHBOARD ACTION) needing JS-bound
 * handlers.
 *
 * @param target - Active Playwright page or frame.
 * @param timeoutMs - Wait budget in milliseconds.
 * @returns Promise resolving to true when load + networkidle both fired.
 */
function handleSpaPrelude(target: ReadinessTarget, timeoutMs: number): Promise<boolean> {
  return waitForSpaReady(target, timeoutMs);
}

/** Lookup table mapping prelude levels to the primitive that implements them. */
const LEVEL_HANDLERS: Record<
  PreludeLevel,
  (target: ReadinessTarget, timeoutMs: number) => Promise<boolean>
> = {
  none: handleNonePrelude,
  dom: handleDomPrelude,
  spa: handleSpaPrelude,
};

/** Bundled args for telemetry emit — fits the 3-param ceiling. */
interface IPreludeTelemetry {
  readonly input: IPreludeContext;
  readonly level: PreludeLevel;
  readonly wasReady: boolean;
  readonly elapsedMs: number;
}

/**
 * Emit the canonical `prelude` telemetry event so `pipeline.log`
 * carries one structured line per call. Per
 * `logging-pii-guidelines.md` rule 6, no payload data — only
 * structural facts (phase / stage / level / ready / elapsedMs).
 *
 * @param t - Bundled telemetry args (context + level + result + elapsed).
 * @returns True after the event is logged.
 */
function emitPreludeEvent(t: IPreludeTelemetry): true {
  t.input.logger.debug({
    event: 'prelude',
    phase: getActivePhase(),
    stage: getActiveStage(),
    level: t.level,
    ready: t.wasReady,
    elapsedMs: t.elapsedMs,
  });
  return true;
}

/**
 * Bundled args for the shared run-with-telemetry path — fits the
 * 3-param ceiling and keeps the call sites symmetric across Page and
 * Frame variants.
 */
interface IReadinessRun {
  readonly input: IPreludeContext;
  readonly target: ReadinessTarget;
  readonly spec: IPreludeSpec;
}

/**
 * Shared core — dispatches to the right primitive, measures elapsed,
 * emits telemetry. Used by both {@link awaitPagePrelude} (page-level)
 * and {@link awaitFramePrelude} (frame-level) so the telemetry shape
 * is identical regardless of the readiness target.
 *
 * @param run - Bundled run args (context + target + spec).
 * @returns True when ready within budget, false on timeout.
 */
async function runReadinessWithTelemetry(run: IReadinessRun): Promise<boolean> {
  const startMs = Date.now();
  const wasReady = await LEVEL_HANDLERS[run.spec.level](run.target, run.spec.timeoutMs);
  emitPreludeEvent({
    input: run.input,
    level: run.spec.level,
    wasReady,
    elapsedMs: Date.now() - startMs,
  });
  return wasReady;
}

/**
 * Phase-aware page-readiness prelude. Reads the active page from the
 * context, dispatches to the right primitive based on `spec.level`,
 * emits structured telemetry, and returns the result.
 *
 * <p>Short-circuits to true when:
 * <ul>
 *   <li>`spec.level === 'none'` (default no-op for non-navigating stages)</li>
 *   <li>{@link isMockTimingActive} is true (MOCK_MODE=1 — fixtures have no lifecycle events)</li>
 * </ul>
 *
 * <p>Returns false when the active page is unavailable (test paths /
 * pre-INIT) — the caller's own probe remains the source of truth.
 *
 * @param input - Any context carrying `browser` + `logger`.
 * @param spec - Declarative prelude specification.
 * @returns True when ready within budget, false on timeout or no-page.
 */
async function awaitPagePrelude(input: IPreludeContext, spec: IPreludeSpec): Promise<boolean> {
  if (spec.level === 'none') return true;
  if (isMockTimingActive()) return true;
  if (!input.browser.has) return false;
  return runReadinessWithTelemetry({ input, target: input.browser.value.page, spec });
}

/**
 * Frame-targeted readiness prelude — sibling of {@link awaitPagePrelude}
 * for stages that need to wait on a specific iframe rather than the
 * top-level page. LOGIN.PRE on hapoalim-group banks (Hapoalim / Massad
 * / OtsarHahayal / Pagi) is the primary caller — the login form lives
 * inside an iframe whose JS bundle hydrates asynchronously after the
 * parent page fires `domcontentloaded`. Without this gate, the
 * resolver scans the iframe before its handlers bind and reports
 * "no password field".
 *
 * <p>Accepts `Page | Frame` so callers like LOGIN.PRE whose
 * `activeFrame` may be either (top-level form vs iframe-hosted form)
 * thread the same value through without a type narrow.
 *
 * <p>Same short-circuit / telemetry contract as {@link awaitPagePrelude}.
 * Caller supplies the target directly — no context-extraction step.
 *
 * @param input - Any context carrying `logger` (for telemetry).
 * @param target - Active Playwright Page or Frame target.
 * @param spec - Declarative prelude specification.
 * @returns True when ready within budget, false on timeout.
 */
async function awaitFramePrelude(
  input: IPreludeContext,
  target: ReadinessTarget,
  spec: IPreludeSpec,
): Promise<boolean> {
  if (spec.level === 'none') return true;
  if (isMockTimingActive()) return true;
  return runReadinessWithTelemetry({ input, target, spec });
}

export type { IPreludeSpec, PreludeLevel };
export { awaitFramePrelude, awaitPagePrelude, PRELUDE_NONE };
