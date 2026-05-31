/**
 * PagePrelude — `awaitPagePrelude` helper unit tests.
 *
 * <p>Pin the contract that every navigating phase delegates to:
 * <ul>
 *   <li>`'none'` short-circuits without touching the page.</li>
 *   <li>`'dom'` dispatches to {@link waitForDomReady}.</li>
 *   <li>`'spa'` dispatches to {@link waitForSpaReady}.</li>
 *   <li>Telemetry event is emitted on every non-short-circuit call.</li>
 *   <li>No page available → returns false.</li>
 * </ul>
 *
 * <p>All inputs deterministic stubs — no real Playwright launch.
 */

import type { Frame, Page } from 'playwright-core';

import type { IPreludeSpec } from '../../../../../Scrapers/Pipeline/Mediator/Elements/PagePrelude.js';
import {
  awaitFramePrelude,
  awaitPagePrelude,
  PRELUDE_NONE,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/PagePrelude.js';
import {
  HOME_PRELUDE_TIMEOUT_MS,
  OTP_FILL_PRELUDE_TIMEOUT_MS,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingConfig.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';

/** Captured logger event payload — keyed by structured-log field name. */
type LogEvent = Record<string, unknown>;

/** Logger levels the prelude helper does NOT exercise — all stubbed as no-ops. */
const LOGGER_NOOP_LEVELS = ['info', 'warn', 'error', 'trace', 'fatal'] as const;

/**
 * Tiny no-op for non-debug logger levels. Returns truthy so callers
 * who use it as a sentinel (rare in tests) keep working.
 *
 * @returns Always true.
 */
const NOOP_LOG_LEVEL = (): true => true;

/**
 * Map a logger level name to a `[name, no-op-fn]` tuple. Pulled out
 * so {@link makeRecordingLogger} stays inside the 10-line ceiling
 * AND the inner `Object.fromEntries(...map(...))` is no longer a
 * forbidden nested-call site.
 *
 * @param key - Logger level name.
 * @returns Entry tuple consumed by `Object.fromEntries`.
 */
function noopEntry(key: string): readonly [string, () => true] {
  return [key, NOOP_LOG_LEVEL];
}

/**
 * Build a logger that records every debug() payload and ignores the
 * other levels. PR #221 review (id 3217306124) — function body now
 * fits inside the 10-line ceiling via a hoisted no-op + spread of
 * noop bindings driven by {@link LOGGER_NOOP_LEVELS}.
 *
 * @param sink - Append target for captured events.
 * @returns Minimal logger satisfying the ScraperLogger contract.
 */
function makeRecordingLogger(sink: LogEvent[]): ScraperLogger {
  /**
   * Capture one structured-log payload from the SUT.
   * @param payload - Debug event the SUT emits.
   * @returns True after the event is recorded.
   */
  const recordDebug = (payload: LogEvent): true => {
    sink.push(payload);
    return true;
  };
  const noopPairs = LOGGER_NOOP_LEVELS.map(noopEntry);
  const noops = Object.fromEntries(noopPairs);
  return { debug: recordDebug, ...noops } as unknown as ScraperLogger;
}

/**
 * Build a Page-like stub that records every waitForLoadState call and
 * throws for any state outside `resolveFor`.
 *
 * @param stateCalls - Sink that captures the lifecycle event name on each call.
 * @param resolveFor - Set of lifecycle events that should resolve (others throw).
 * @returns Page-like stub.
 */
function makeListeningPage(stateCalls: string[], resolveFor: ReadonlySet<string>): Page {
  /**
   * Records the awaited state name then either resolves or simulates
   * a Playwright timeout, depending on whether the state is in the
   * allowlist.
   *
   * @param state - Lifecycle event name the SUT is awaiting.
   * @returns Resolves when state is in resolveFor; throws otherwise.
   */
  async function waitForLoadStateStub(state: string): Promise<void> {
    stateCalls.push(state);
    await Promise.resolve();
    if (!resolveFor.has(state)) {
      throw new TypeError(`prelude-test timeout simulated for ${state}`);
    }
  }
  return { waitForLoadState: waitForLoadStateStub } as unknown as Page;
}

/** Context shape produced by {@link makeCtxWithPage}. */
interface ICtxWithPage {
  readonly browser: ReturnType<typeof some<{ page: Page }>>;
  readonly logger: ScraperLogger;
}

/**
 * Bundle a Page stub + logger into the minimal context shape the helper
 * needs.
 *
 * @param page - Page-like stub.
 * @param logger - Recording logger.
 * @returns Context with browser + logger fields.
 */
function makeCtxWithPage(page: Page, logger: ScraperLogger): ICtxWithPage {
  const browserState = some({ page });
  return { browser: browserState, logger };
}

/**
 * Filter events down to the prelude telemetry rows only.
 *
 * @param events - Captured events from the recording logger.
 * @returns Events whose `event` field equals `'prelude'`.
 */
function preludeOnly(events: LogEvent[]): LogEvent[] {
  return events.filter((e): boolean => e.event === 'prelude');
}

/** Bundle of test fixtures produced by {@link buildPagePreludeScenario}. */
interface IPagePreludeScenario {
  readonly stateCalls: string[];
  readonly events: LogEvent[];
  readonly ctx: ICtxWithPage;
}

/**
 * Build the standard arrange harness for `awaitPagePrelude` tests —
 * fresh sinks + a recording logger + a Page stub wired to `resolveFor`.
 * PR #221 review (id 3217306124): collapses the 5-line per-test arrange
 * pattern into one call.
 *
 * @param resolveFor - Lifecycle events the Page stub should resolve.
 * @returns Bundled fixtures (state-calls sink, events sink, ctx).
 */
function buildPagePreludeScenario(resolveFor: ReadonlySet<string>): IPagePreludeScenario {
  const stateCalls: string[] = [];
  const events: LogEvent[] = [];
  const page = makeListeningPage(stateCalls, resolveFor);
  const logger = makeRecordingLogger(events);
  return { stateCalls, events, ctx: makeCtxWithPage(page, logger) };
}

// PR #221 review (id 3217306133): the suite previously hard-coded
// `timeoutMs: 5_000` for both specs. Sourced from `TimingConfig.ts`
// instead so the central ceilings remain the single source of truth —
// `HOME_PRELUDE_TIMEOUT_MS` is a representative SPA-level budget;
// `OTP_FILL_PRELUDE_TIMEOUT_MS` is a representative DOM-level budget.
const SPA_SPEC: IPreludeSpec = { level: 'spa', timeoutMs: HOME_PRELUDE_TIMEOUT_MS };
const DOM_SPEC: IPreludeSpec = { level: 'dom', timeoutMs: OTP_FILL_PRELUDE_TIMEOUT_MS };
const DOM_ONLY = new Set(['domcontentloaded']);
const LOAD_AND_IDLE = new Set(['load', 'networkidle']);
const NEVER_RESOLVE: ReadonlySet<string> = new Set<string>();

describe('awaitPagePrelude — phase-aware readiness gate', () => {
  it("PRELUDE-NONE-001: 'none' short-circuits true without touching the page", async () => {
    const sc = buildPagePreludeScenario(NEVER_RESOLVE);
    const wasReady = await awaitPagePrelude(sc.ctx, PRELUDE_NONE);
    expect(wasReady).toBe(true);
    expect(sc.stateCalls).toEqual([]);
    const emitted = preludeOnly(sc.events);
    expect(emitted).toEqual([]);
  });

  it("PRELUDE-DOM-002: 'dom' calls waitForDomReady and emits telemetry", async () => {
    const sc = buildPagePreludeScenario(DOM_ONLY);
    const wasReady = await awaitPagePrelude(sc.ctx, DOM_SPEC);
    expect(wasReady).toBe(true);
    expect(sc.stateCalls).toEqual(['domcontentloaded']);
    const emitted = preludeOnly(sc.events);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].level).toBe('dom');
    expect(emitted[0].ready).toBe(true);
  });

  it("PRELUDE-SPA-003: 'spa' calls waitForSpaReady (both load + networkidle)", async () => {
    const sc = buildPagePreludeScenario(LOAD_AND_IDLE);
    const wasReady = await awaitPagePrelude(sc.ctx, SPA_SPEC);
    expect(wasReady).toBe(true);
    const sortedCalls = [...sc.stateCalls].sort((a, b): number => a.localeCompare(b));
    expect(sortedCalls).toEqual(['load', 'networkidle']);
  });

  it('PRELUDE-NO-PAGE-004: returns false when browser is not attached', async () => {
    const events: LogEvent[] = [];
    const logger = makeRecordingLogger(events);
    const ctx = { browser: none(), logger };
    const wasReady = await awaitPagePrelude(ctx, DOM_SPEC);
    expect(wasReady).toBe(false);
    const emitted = preludeOnly(events);
    expect(emitted).toEqual([]);
  });

  it('PRELUDE-TIMEOUT-005: returns false when lifecycle event times out', async () => {
    const sc = buildPagePreludeScenario(NEVER_RESOLVE);
    const wasReady = await awaitPagePrelude(sc.ctx, DOM_SPEC);
    expect(wasReady).toBe(false);
    const emitted = preludeOnly(sc.events);
    expect(emitted[0].ready).toBe(false);
  });

  it('PRELUDE-TELEMETRY-006: emits structured event with phase, stage, level, elapsedMs', async () => {
    const sc = buildPagePreludeScenario(DOM_ONLY);
    await awaitPagePrelude(sc.ctx, DOM_SPEC);
    const preludeEvent = sc.events.find((e): boolean => e.event === 'prelude');
    expect(preludeEvent).toBeDefined();
    expect(typeof preludeEvent?.phase).toBe('string');
    expect(typeof preludeEvent?.stage).toBe('string');
    expect(preludeEvent?.level).toBe('dom');
    expect(typeof preludeEvent?.elapsedMs).toBe('number');
  });
});

/**
 * Build a Frame-like stub that records every waitForLoadState call.
 *
 * @param stateCalls - Sink that captures the lifecycle event name on each call.
 * @param resolveFor - Set of lifecycle events that should resolve (others throw).
 * @returns Frame-like stub.
 */
function makeListeningFrame(stateCalls: string[], resolveFor: ReadonlySet<string>): Frame {
  /**
   * Records the awaited state name then either resolves or throws —
   * Frame variant of the page stub above.
   *
   * @param state - Lifecycle event name the SUT awaits.
   * @returns Resolves when state is in resolveFor; throws otherwise.
   */
  async function waitForLoadStateStub(state: string): Promise<void> {
    stateCalls.push(state);
    await Promise.resolve();
    if (!resolveFor.has(state)) {
      throw new TypeError(`frame-prelude-test timeout simulated for ${state}`);
    }
  }
  return { waitForLoadState: waitForLoadStateStub } as unknown as Frame;
}

/**
 * Build a logger-only context (no browser) for Frame-prelude callers
 * who supply the target directly.
 *
 * @param logger - Recording logger.
 * @returns Minimal context with `browser: none()` + logger.
 */
function makeLoggerOnlyCtx(logger: ScraperLogger): {
  readonly browser: ReturnType<typeof none>;
  readonly logger: ScraperLogger;
} {
  return { browser: none(), logger };
}

/** Bundle of test fixtures produced by {@link buildFramePreludeScenario}. */
interface IFramePreludeScenario {
  readonly stateCalls: string[];
  readonly events: LogEvent[];
  readonly frame: Frame;
  readonly ctx: ReturnType<typeof makeLoggerOnlyCtx>;
}

/**
 * Build the standard arrange harness for `awaitFramePrelude` tests —
 * mirrors {@link buildPagePreludeScenario} for the frame-target variant.
 * PR #221 review (id 3217306124).
 *
 * @param resolveFor - Lifecycle events the Frame stub should resolve.
 * @returns Bundled fixtures (state-calls sink, events sink, frame, ctx).
 */
function buildFramePreludeScenario(resolveFor: ReadonlySet<string>): IFramePreludeScenario {
  const stateCalls: string[] = [];
  const events: LogEvent[] = [];
  const frame = makeListeningFrame(stateCalls, resolveFor);
  const logger = makeRecordingLogger(events);
  return { stateCalls, events, frame, ctx: makeLoggerOnlyCtx(logger) };
}

describe('awaitFramePrelude — Frame/Page-target readiness gate', () => {
  it("FRAME-PRELUDE-NONE-001: 'none' short-circuits true without touching the frame", async () => {
    const sc = buildFramePreludeScenario(NEVER_RESOLVE);
    const wasReady = await awaitFramePrelude(sc.ctx, sc.frame, PRELUDE_NONE);
    expect(wasReady).toBe(true);
    expect(sc.stateCalls).toEqual([]);
    const emitted = preludeOnly(sc.events);
    expect(emitted).toEqual([]);
  });

  it("FRAME-PRELUDE-DOM-002: 'dom' delegates waitForDomReady to the FRAME (not a page)", async () => {
    const sc = buildFramePreludeScenario(DOM_ONLY);
    const wasReady = await awaitFramePrelude(sc.ctx, sc.frame, DOM_SPEC);
    expect(wasReady).toBe(true);
    expect(sc.stateCalls).toEqual(['domcontentloaded']);
  });

  it("FRAME-PRELUDE-SPA-003: 'spa' delegates load + networkidle to the frame", async () => {
    const sc = buildFramePreludeScenario(LOAD_AND_IDLE);
    const wasReady = await awaitFramePrelude(sc.ctx, sc.frame, SPA_SPEC);
    expect(wasReady).toBe(true);
    const sortedCalls = [...sc.stateCalls].sort((a, b): number => a.localeCompare(b));
    expect(sortedCalls).toEqual(['load', 'networkidle']);
  });

  it('FRAME-PRELUDE-TIMEOUT-004: returns false when the lifecycle event times out', async () => {
    const sc = buildFramePreludeScenario(NEVER_RESOLVE);
    const wasReady = await awaitFramePrelude(sc.ctx, sc.frame, DOM_SPEC);
    expect(wasReady).toBe(false);
    const emitted = preludeOnly(sc.events);
    expect(emitted[0].ready).toBe(false);
  });

  it('FRAME-PRELUDE-TELEMETRY-005: emits structured event with phase, stage, level, elapsedMs', async () => {
    const sc = buildFramePreludeScenario(DOM_ONLY);
    await awaitFramePrelude(sc.ctx, sc.frame, DOM_SPEC);
    const preludeEvent = sc.events.find((e): boolean => e.event === 'prelude');
    expect(preludeEvent).toBeDefined();
    expect(preludeEvent?.level).toBe('dom');
    expect(typeof preludeEvent?.elapsedMs).toBe('number');
  });

  it('FRAME-PRELUDE-NO-BROWSER-OK-006: works with logger-only context (no browser dependency)', async () => {
    const sc = buildFramePreludeScenario(DOM_ONLY);
    const wasReady = await awaitFramePrelude(sc.ctx, sc.frame, DOM_SPEC);
    expect(wasReady).toBe(true);
  });
});
