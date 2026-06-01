/**
 * Unit tests for EnvSnapshot — the Camoufox-aware PIPELINE-ENV
 * emitter that captures the host process state (browser metadata,
 * viewport, Camoufox env knobs, Node host info) so the gap between
 * CI and local environments becomes visible in init-time logs.
 *
 * <p>Covers:
 *
 * <ul>
 *  <li>Happy path — every snapshot field is sourced correctly and
 *      a single `PIPELINE-ENV` log line is emitted (forensics
 *      enabled).</li>
 *  <li>Viewport accessor missing — falls back to NO_DIMENSION.</li>
 *  <li>Browser-version accessor throws — falls back to
 *      UNKNOWN_ENV_VALUE.</li>
 *  <li>Browser-type accessor throws — falls back to
 *      UNKNOWN_ENV_VALUE.</li>
 *  <li>Logger throws — outer wrapper swallows and resolves with the
 *      captured snapshot (never-throws contract).</li>
 *  <li>Forensics gate OFF (default) — no log emitted, fallback
 *      snapshot returned. Restores the WAF-passing byte-identical
 *      baseline; opt-in only.</li>
 * </ul>
 *
 * <p>Mocking strategy: lightweight stubs for Browser / Page / Logger
 * built from module-level helpers so the file complies with the
 * project's JSDoc-on-every-function rule.
 */

import type { Browser, BrowserType, Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { logEnvSnapshot } from '../../../../../Scrapers/Pipeline/Mediator/Init/EnvSnapshot.js';
import { INIT_FORENSICS_ENV_VAR } from '../../../../../Scrapers/Pipeline/Mediator/Init/InitForensicsGate.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { isSome, none, type Option, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';

/* ─── Generic scripted-value helpers ───────────────────────── */

/**
 * Module-level scripted-string getter — used by Browser/Page stubs.
 *
 * @param value - Pre-bound string.
 * @returns The bound string.
 */
function returnString(value: string): string {
  return value;
}

/**
 * Module-level throwing-string getter — exercises the never-throws
 * fallbacks in {@link logEnvSnapshot}'s sub-reads.
 *
 * @returns Never returns; always throws.
 */
function throwString(): string {
  throw new ScraperError('accessor failed');
}

/* ─── Logger stub ──────────────────────────────────────────── */

/** Captured log calls — one per `logger.info(payload)` invocation. */
interface ILoggerCall {
  readonly level: 'info';
  readonly payload: Record<string, unknown>;
}

/** Logger stub with an exposed call buffer. */
interface IRecordingLogger extends ScraperLogger {
  readonly calls: ILoggerCall[];
}

/**
 * Record an `info` log call into the buffer.
 *
 * @param calls - Shared call buffer.
 * @param payload - Payload passed to `logger.info`.
 * @returns Always `true`.
 */
function recordInfo(calls: ILoggerCall[], payload: Record<string, unknown>): boolean {
  calls.push({ level: 'info', payload });
  return true;
}

/**
 * Build a logger stub that records every call into its buffer.
 *
 * @returns Recording logger.
 */
function makeRecordingLogger(): IRecordingLogger {
  const calls: ILoggerCall[] = [];
  const info = recordInfo.bind(null, calls);
  const noop = makeNoopLog();
  return { calls, info, warn: noop, error: noop, debug: noop } as unknown as IRecordingLogger;
}

/**
 * Build a no-op log function used for the non-info levels of the
 * recording logger stub.
 *
 * @returns Always-true sink function.
 */
function makeNoopLog(): (payload: Record<string, unknown>) => boolean {
  return noopLog;
}

/**
 * Module-level no-op log sink — kept at module level so the logger
 * stub avoids inline arrows.
 *
 * @returns Always `true`.
 */
function noopLog(): boolean {
  return true;
}

/**
 * Build a logger stub whose `info` throws. Other levels are no-ops.
 *
 * @returns Throwing logger.
 */
function makeThrowingLogger(): ScraperLogger {
  const noop = makeNoopLog();
  return { info: throwString, warn: noop, error: noop, debug: noop } as unknown as ScraperLogger;
}

/* ─── Browser stub ─────────────────────────────────────────── */

/** Inputs bundle for {@link makeBrowser} (`max-params: 3`). */
interface IBrowserStubInput {
  readonly name: string;
  readonly version: string;
}

/**
 * Module-level scripted-BrowserType getter so the Browser stub
 * avoids inline arrows.
 *
 * @param browserType - Pre-bound BrowserType stub.
 * @returns The bound BrowserType stub.
 */
function returnBrowserType(browserType: BrowserType): BrowserType {
  return browserType;
}

/**
 * Build a BrowserType stub whose `name()` returns the supplied
 * string. Cast through `unknown` so Playwright's interface is
 * accepted without re-implementing the full surface.
 *
 * @param name - `name()` return value (e.g. `firefox`).
 * @returns BrowserType stub.
 */
function makeBrowserType(name: string): BrowserType {
  const nameFn = returnString.bind(null, name);
  return { name: nameFn } as unknown as BrowserType;
}

/**
 * Build a Browser stub exposing `.version()` and `.browserType()`.
 *
 * @param input - Stub inputs.
 * @returns Browser stub.
 */
function makeBrowser(input: IBrowserStubInput): Browser {
  const type = makeBrowserType(input.name);
  const versionFn = returnString.bind(null, input.version);
  const typeFn = returnBrowserType.bind(null, type);
  return { version: versionFn, browserType: typeFn } as unknown as Browser;
}

/**
 * Build a Browser stub whose `.version()` accessor throws.
 *
 * @param name - `browserType().name()` return value.
 * @returns Browser stub with throwing `version()`.
 */
function makeBrowserWithThrowingVersion(name: string): Browser {
  const type = makeBrowserType(name);
  const typeFn = returnBrowserType.bind(null, type);
  return { version: throwString, browserType: typeFn } as unknown as Browser;
}

/**
 * Module-level throwing BrowserType getter.
 *
 * @returns Never returns; always throws.
 */
function throwBrowserType(): BrowserType {
  throw new ScraperError('browserType failed');
}

/**
 * Build a Browser stub whose `.browserType()` accessor throws.
 *
 * @param version - `version()` return value.
 * @returns Browser stub with throwing `browserType()`.
 */
function makeBrowserWithThrowingType(version: string): Browser {
  const versionFn = returnString.bind(null, version);
  return { version: versionFn, browserType: throwBrowserType } as unknown as Browser;
}

/* ─── Page stub ────────────────────────────────────────────── */

/** Viewport shape returned by `page.viewportSize()`. */
interface IViewport {
  width: number;
  height: number;
}

/** Inputs bundle for {@link makePage} (`max-params: 3`). */
interface IPageStubInput {
  readonly viewport: Option<IViewport>;
}

/**
 * Module-level helper that returns `null` ONCE and only through a
 * deliberate cast — used by the page stub since Playwright's
 * `viewportSize()` legitimately returns `null` when no viewport is
 * configured. Kept in a single audit point so the rest of the file
 * stays clean of `null` types.
 *
 * @returns Playwright's null-viewport sentinel.
 */
function makeNullViewportValue(): IViewport {
  return null as unknown as IViewport;
}

/**
 * Module-level scripted-viewport getter so the Page stub avoids
 * inline arrows. Returns Playwright's native `IViewport | null`
 * via the {@link makeNullViewportValue} cast.
 *
 * @param viewport - Pre-bound viewport Option.
 * @returns The bound viewport or the null-viewport sentinel.
 */
function returnViewport(viewport: Option<IViewport>): IViewport {
  if (isSome(viewport)) return viewport.value;
  return makeNullViewportValue();
}

/**
 * Build a Page stub with the supplied viewport. `page.evaluate` is
 * NOT stubbed because EnvSnapshot no longer invokes it (the prior
 * about:blank page.evaluate call was the source of the PR-#289
 * Hapoalim hCaptcha regression and has been removed).
 *
 * @param input - Page-stub inputs.
 * @returns Page stub.
 */
function makePage(input: IPageStubInput): Page {
  const viewportFn = returnViewport.bind(null, input.viewport);
  return { viewportSize: viewportFn } as unknown as Page;
}

/* ─── Fixture helpers ──────────────────────────────────────── */

/**
 * Extract the captured PIPELINE-ENV payload from the recording
 * logger. Asserts exactly one call was made.
 *
 * @param logger - Recording logger.
 * @returns The captured payload, typed as IEnvSnapshot + event.
 */
function readEmittedPayload(logger: IRecordingLogger): Record<string, unknown> {
  expect(logger.calls).toHaveLength(1);
  const call = logger.calls[0];
  expect(call.level).toBe('info');
  return call.payload;
}

/**
 * Build a Page stub with the default "happy" viewport — the most
 * common test setup. Extracted to keep call sites short and to
 * avoid duplicating the Option-wrap dance.
 *
 * @returns Page stub with 1920×1080 viewport.
 */
function makeHappyPage(): Page {
  const viewport = some<IViewport>({ width: 1920, height: 1080 });
  return makePage({ viewport });
}

/* ─── Forensics gate helpers ───────────────────────────────── */

/**
 * Enable forensics for a test block via the env-var gate.
 *
 * @returns Always `true`.
 */
function enableForensics(): boolean {
  process.env[INIT_FORENSICS_ENV_VAR] = '1';
  return true;
}

/* ─── Tests ────────────────────────────────────────────────── */

describe('logEnvSnapshot — happy path (forensics ON)', () => {
  beforeEach(enableForensics);
  afterEach(disableForensics);

  it('captures browser + viewport + Camoufox knobs and emits one PIPELINE-ENV log', async () => {
    const browser = makeBrowser({ name: 'firefox', version: '139.0.4' });
    const page = makeHappyPage();
    const logger = makeRecordingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger });
    expect(snapshot.browserName).toBe('firefox');
    expect(snapshot.browserVersion).toBe('139.0.4');
    expect(snapshot.viewportWidth).toBe(1920);
    expect(snapshot.viewportHeight).toBe(1080);
    const payload = readEmittedPayload(logger);
    expect(payload.event).toBe('PIPELINE-ENV');
    expect(payload.browserName).toBe('firefox');
  });

  it('emits process-side fields from the Node runtime', async () => {
    const browser = makeBrowser({ name: 'firefox', version: '139' });
    const page = makeHappyPage();
    const logger = makeRecordingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger });
    expect(snapshot.nodeVersion).toBe(process.versions.node);
    expect(snapshot.platform).toBe(process.platform);
    expect(snapshot.arch).toBe(process.arch);
    expect(snapshot.pid).toBe(process.pid);
  });
});

describe('logEnvSnapshot — never-throws contract (forensics ON)', () => {
  beforeEach(enableForensics);
  afterEach(disableForensics);

  it('falls back to NO_DIMENSION when viewportSize returns null', async () => {
    const browser = makeBrowser({ name: 'firefox', version: '139' });
    const page = makePage({ viewport: none() });
    const logger = makeRecordingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger });
    expect(snapshot.viewportWidth).toBe(0);
    expect(snapshot.viewportHeight).toBe(0);
  });

  it('falls back to UNKNOWN_ENV_VALUE when browser.version() throws', async () => {
    const browser = makeBrowserWithThrowingVersion('firefox');
    const page = makeHappyPage();
    const logger = makeRecordingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger });
    expect(snapshot.browserVersion).toBe('unknown');
    expect(snapshot.browserName).toBe('firefox');
  });

  it('falls back to UNKNOWN_ENV_VALUE when browser.browserType() throws', async () => {
    const browser = makeBrowserWithThrowingType('139');
    const page = makeHappyPage();
    const logger = makeRecordingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger });
    expect(snapshot.browserName).toBe('unknown');
    expect(snapshot.browserVersion).toBe('139');
  });

  it('resolves with the captured snapshot even when logger.info throws', async () => {
    const browser = makeBrowser({ name: 'firefox', version: '139' });
    const page = makeHappyPage();
    const throwingLogger = makeThrowingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger: throwingLogger });
    expect(snapshot.browserName).toBe('firefox');
    expect(snapshot.browserVersion).toBe('139');
  });
});

describe('logEnvSnapshot — forensics gate (default OFF)', () => {
  beforeEach(disableForensics);
  afterEach(disableForensics);

  it('emits NO log and returns the fallback snapshot when the gate is unset', async () => {
    const browser = makeBrowser({ name: 'firefox', version: '139.0.4' });
    const page = makeHappyPage();
    const logger = makeRecordingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger });
    expect(logger.calls).toHaveLength(0);
    expect(snapshot.browserName).toBe('unknown');
    expect(snapshot.browserVersion).toBe('unknown');
  });

  it('does NOT call browser accessors when gate is off (zero side-effects)', async () => {
    const browser = makeBrowserWithThrowingVersion('firefox');
    const page = makeHappyPage();
    const logger = makeRecordingLogger();
    const snapshot = await logEnvSnapshot({ browser, page, logger });
    expect(snapshot.browserName).toBe('unknown');
    expect(logger.calls).toHaveLength(0);
  });
});

describe('logEnvSnapshot — Camoufox env knobs (forensics ON)', () => {
  beforeEach(enableForensics);
  afterEach(disableForensics);

  it('captures the three CAMOUFOX_* env vars (or <unset> when missing)', async () => {
    const priorHumanize = snapshotEnv('CAMOUFOX_HUMANIZE');
    const priorCoop = snapshotEnv('CAMOUFOX_DISABLE_COOP');
    const priorWebrtc = snapshotEnv('CAMOUFOX_BLOCK_WEBRTC');
    process.env.CAMOUFOX_HUMANIZE = 'true';
    Reflect.deleteProperty(process.env, 'CAMOUFOX_DISABLE_COOP');
    process.env.CAMOUFOX_BLOCK_WEBRTC = 'false';
    await runKnobAssertions();
    restoreEnv('CAMOUFOX_HUMANIZE', priorHumanize);
    restoreEnv('CAMOUFOX_DISABLE_COOP', priorCoop);
    restoreEnv('CAMOUFOX_BLOCK_WEBRTC', priorWebrtc);
  });
});

/**
 * Disable forensics for a test block (the safe default).
 *
 * @returns Always `true`.
 */
function disableForensics(): boolean {
  Reflect.deleteProperty(process.env, INIT_FORENSICS_ENV_VAR);
  return true;
}

/**
 * Run the knob-capture assertions after the env-vars have been
 * pre-staged by the test body. Extracted so the test stays under
 * the file's overall LoC budget and the env snapshot/restore
 * sequence is easy to audit at a glance.
 */
async function runKnobAssertions(): Promise<void> {
  const browser = makeBrowser({ name: 'firefox', version: '139' });
  const viewport = some<IViewport>({ width: 1920, height: 1080 });
  const page = makePage({ viewport });
  const logger = makeRecordingLogger();
  const snapshot = await logEnvSnapshot({ browser, page, logger });
  expect(snapshot.camoufoxHumanize).toBe('true');
  expect(snapshot.camoufoxDisableCoop).toBe('<unset>');
  expect(snapshot.camoufoxBlockWebrtc).toBe('false');
}

/**
 * Restore the previous value of an env-var after a test mutated it.
 *
 * @param name - Env-var name.
 * @param prior - Pre-test value (or `none()` if it was unset).
 * @returns Always `true`.
 */
function restoreEnv(name: string, prior: Option<string>): boolean {
  if (!isSome(prior)) Reflect.deleteProperty(process.env, name);
  else process.env[name] = prior.value;
  return true;
}

/**
 * Snapshot an env-var into an Option so {@link restoreEnv} can put
 * it back exactly as it was (including unset).
 *
 * @param name - Env-var name.
 * @returns Option-wrapped current value.
 */
function snapshotEnv(name: string): Option<string> {
  const value = process.env[name];
  if (value === undefined) return none();
  return some(value);
}
