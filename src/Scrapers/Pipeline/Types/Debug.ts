import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type Logger } from 'pino';

import { getActivePhase, getActiveStage } from './ActiveState.js';
import type { Brand } from './Brand.js';
import { SENSITIVE_PATHS } from './DebugConfig.js';
import { createCensorFn } from './PiiRedactor.js';
import { getActiveRunId, getLogFile } from './TraceConfig.js';

/** URL basename string — branded for Rule #15. */
type UrlBasename = Brand<string, 'UrlBasename'>;
/** Kebab-cased logger name derived from a source filename. */
type LoggerNameKebab = Brand<string, 'LoggerNameKebab'>;

/** Bank context shape for async-local storage. */
interface IBankContext {
  readonly [key: string]: string;
  bank: string;
}

/**
 * Create the async-local store for bank context.
 * Uses Reflect.construct to avoid the no-restricted-syntax rule on `new X()`.
 * @returns A typed AsyncLocalStorage instance.
 */
function createBankStore(): AsyncLocalStorage<IBankContext> {
  return Reflect.construct(AsyncLocalStorage, []) as AsyncLocalStorage<IBankContext>;
}

/** Async-local store for per-request bank context injected into every log line. */
const BANK_CONTEXT = createBankStore();

/** Single source of truth censor — built from PiiRedactor strategies. */
const CENSOR = createCensorFn();

/**
 * Pino mixin: injects ambient context onto every log line so callers
 * never have to attach `bank` / `phase` / `stage` / `runId` manually.
 *
 * Fields:
 *   - `bank` / extra fields — read from the AsyncLocalStorage scope
 *     established by {@link runWithBankContext}.
 *   - `phase` — current pipeline phase (init / login / scrape / …).
 *   - `stage` — 4-stage protocol (PRE / ACTION / POST / FINAL).
 *   - `runId` — per-process run-stamp (`DD-MM-YYYY_HHMMSScc`); SAME
 *     value the trace artefact folder is named with on disk, so a log
 *     line can be deterministically joined to its `network/` and
 *     `screenshots/` siblings even after logs are aggregated off-host.
 *     Omitted from the mixin object when empty (pre-`setActiveBank`
 *     log lines) so it never appears as `runId:""` noise.
 *
 * @returns Mixin fields to merge onto every log entry.
 */
function getBankMixin(): Record<string, string> {
  const bank = BANK_CONTEXT.getStore() ?? {};
  const runId = getActiveRunId();
  const ambient: Record<string, string> = {
    ...bank,
    phase: getActivePhase(),
    stage: getActiveStage(),
  };
  if (runId.length > 0) ambient.runId = runId;
  return ambient;
}

const isDevMode = !process.env.CI && process.env.NODE_ENV !== 'production';

/** Pino transport for dev mode (pretty printing). */
const DEV_TRANSPORT = { target: 'pino-pretty', options: { colorize: true } };

/** Pino's redact options type — pulled from the library so the censor cast
 *  doesn't need to spell `unknown` literally (the codebase forbids that). */
type PinoRedactOptions = NonNullable<pino.LoggerOptions['redact']>;
/** Type of the `censor` field accepted by pino's redact configuration. */
type PinoCensorFn = Extract<PinoRedactOptions, { censor?: unknown }>['censor'];

/**
 * Build pino transport — terminal only or terminal + file.
 * @param logFile - Resolved log file path (empty string disables file output).
 * @returns Transport config or false.
 */
function buildTransport(
  logFile: string,
): pino.TransportSingleOptions | pino.TransportMultiOptions | false {
  if (!isDevMode && !logFile) return false;
  if (!logFile) return DEV_TRANSPORT;
  if (!isDevMode) {
    return { target: 'pino/file', options: { destination: logFile } };
  }
  return {
    targets: [
      { target: 'pino-pretty', options: { colorize: true }, level: 'trace' },
      { target: 'pino/file', options: { destination: logFile }, level: 'trace' },
    ],
  };
}

/** Cached root pino instance — built lazily on first log call so file
 *  destination is resolved AFTER setActiveBank has fired in the orchestrator. */
let rootLoggerCache: Logger | false = false;

/**
 * Build (or return cached) root logger. Deferred so getLogFile() runs
 * after `executePipeline` has registered the active bank — only then can
 * TraceConfig produce a real `<RUNS_ROOT>/pipeline/<bank>/<stamp>/pipeline.log`
 * destination.
 * @returns Root pino instance.
 */
function getRootLogger(): Logger {
  if (rootLoggerCache) return rootLoggerCache;
  const logFile = getLogFile();
  const transport = buildTransport(logFile);
  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    ...(transport && { transport }),
    redact: {
      paths: SENSITIVE_PATHS,
      censor: CENSOR as unknown as PinoCensorFn,
    },
    mixin: getBankMixin,
  });
  if (logFile) rootLoggerCache = logger;
  return logger;
}

export type ScraperLogger = Logger;

/** Per-name cached deferred-child entry. */
interface IDeferredChildEntry {
  resolved: Logger | false;
}

/** Reflected value off a pino Logger — narrowed to the keyof-union shape. */
type LoggerProperty = Logger[keyof Logger];

/**
 * Lazy-resolve handler for the JS Proxy used by `getDebug`. On first
 * property access, builds the real pino child (which by then has the
 * file transport wired in via setActiveBank) and forwards every method
 * call there.
 */
interface IProxyHandler {
  get: (target: object, prop: string | symbol) => LoggerProperty;
}

/**
 * Property-access handler for the lazy logger Proxy — first access builds
 * a child logger from the current root. The child is cached only once the
 * root itself is cached (which only happens when `getLogFile()` resolved a
 * real destination, i.e. `setActiveBank` has fired). Pre-`setActiveBank`
 * calls keep rebuilding the child each access (cheap, microseconds) so the
 * first post-`setActiveBank` access automatically picks up the file
 * transport without a manual refresh.
 * @param name - Module name attached to the resolved child.
 * @param entry - Mutable cache slot for the resolved child.
 * @param prop - Property name being read on the proxy.
 * @returns Whatever pino Logger exposes at that key.
 */
function reflectChildProperty(
  name: string,
  entry: IDeferredChildEntry,
  prop: string | symbol,
): LoggerProperty {
  if (entry.resolved) return Reflect.get(entry.resolved, prop) as LoggerProperty;
  const child = getRootLogger().child({ module: name });
  if (rootLoggerCache) entry.resolved = child;
  return Reflect.get(child, prop) as LoggerProperty;
}

/**
 * Build the proxy handler that lazily resolves a pino child for `name`.
 * @param name - The module name for the child logger.
 * @param entry - Mutable cache slot for the resolved child.
 * @returns Proxy handler.
 */
function makeChildProxyHandler(name: string, entry: IDeferredChildEntry): IProxyHandler {
  return {
    /**
     * Forward property access to the lazily-built child logger.
     * @param _target - Empty object placeholder (unused).
     * @param prop - Property name being accessed on the proxy.
     * @returns Delegated property value from the resolved child.
     */
    get: (_target: object, prop: string | symbol): LoggerProperty => {
      return reflectChildProperty(name, entry, prop);
    },
  };
}

/** File-extension regex used by `deriveLogName` (non-capturing). */
const FILE_EXT_RE = /\.(?:ts|js|tsx|jsx|mjs|cjs)$/;
/** PascalCase split regex for kebab-casing. */
const PASCAL_SPLIT_RE = /([a-z0-9])([A-Z])/g;

/**
 * Take the basename of a `file:///` URL — the part after the last `/`.
 * @param metaUrl - The caller's `import.meta.url`.
 * @returns The filename portion (or the input itself if no `/` present).
 */
function basenameFromUrl(metaUrl: string): UrlBasename {
  const cleaned = metaUrl.split('?')[0].split('#')[0];
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash < 0) return cleaned as UrlBasename;
  return cleaned.substring(lastSlash + 1) as UrlBasename;
}

/**
 * Architectural Force — derive the logger name from `import.meta.url`. The
 * caller passes `import.meta.url` (a `file:///...` URL); we extract the
 * basename, drop the extension, and kebab-case PascalCase. So
 * `file:///.../Mediator/Elements/ActionExecutors.ts` becomes
 * `action-executors`. No manual logger name strings anywhere.
 * @param metaUrl - The caller's `import.meta.url`.
 * @returns Kebab-cased module name.
 */
function deriveLogName(metaUrl: string): LoggerNameKebab {
  const last = basenameFromUrl(metaUrl);
  const stem = last.replace(FILE_EXT_RE, '');
  const kebab = stem.replaceAll(PASCAL_SPLIT_RE, '$1-$2').toLowerCase();
  return kebab as LoggerNameKebab;
}

/**
 * Build a deferred-resolve child logger for a module. Capturing
 * `const LOG = getDebug(import.meta.url)` at module-load is safe: no pino
 * instance is built until the first method access on `LOG`. By then
 * `executePipeline` has called `setActiveBank` and `getLogFile()` returns
 * a real path, so the lazy root logger gets the file transport.
 *
 * Architectural Force: callers MUST pass `import.meta.url`. The logger
 * name is derived from the source filename — no manual name strings.
 * @param metaUrl - The caller's `import.meta.url`.
 * @returns A pino-shaped logger that defers child creation.
 */
export function getDebug(metaUrl: string): Logger {
  const name = deriveLogName(metaUrl);
  return buildDeferredLogger(name);
}

/**
 * Compatibility entry-point for legacy Common-side callers that pass a
 * manual module name string (e.g. `getDebug('leumi-scraper')`) or a
 * dynamic bank identifier (e.g. `getDebug(options.companyId)`). Pipeline
 * code MUST keep using {@link getDebug} with `import.meta.url`; this
 * adapter exists only so the Common shim at `src/Common/Debug.ts`
 * preserves verbatim `module:` log values during the Phase-3 unification
 * window, without forcing the legacy scrapers (BaseScraper, Leumi,
 * Mizrahi, BeyahadBishvilha, …) to migrate to `import.meta.url` in this
 * commit.
 * @param name - Verbatim module name written into the `module:` log field.
 * @returns A pino-shaped logger that defers child creation.
 */
export function getDebugByName(name: string): Logger {
  return buildDeferredLogger(name);
}

/**
 * Shared proxy/deferred-resolve assembly used by both {@link getDebug}
 * and {@link getDebugByName}. Extracted so adding a third caller-shape
 * adapter in the future stays trivial.
 * @param name - Logger module name (either kebab-derived from a URL or
 *   the verbatim legacy string passed by Common-side callers).
 * @returns A pino-shaped logger that defers child creation.
 */
function buildDeferredLogger(name: string): Logger {
  const entry: IDeferredChildEntry = { resolved: false };
  const target: object = {};
  const handler = makeChildProxyHandler(name, entry);
  return Reflect.construct(Proxy, [target, handler]) as Logger;
}

/**
 * Run a function with bank context injected into all pino log lines.
 * @param bank - The bank identifier (companyId).
 * @param fn - The async function to execute within the bank context.
 * @returns The result of the function.
 */
export function runWithBankContext<T>(bank: string, fn: () => T): T {
  return BANK_CONTEXT.run({ bank }, fn);
}

/**
 * Read-only accessor for the pino mixin record — every log line gets
 * these fields injected automatically through pino's `mixin` hook.
 * Production code never needs to call this; exposed so unit tests can
 * assert the auto-injection contract (notably `runId`) directly,
 * without depending on async file-transport flush timing.
 * @returns Same record the pino mixin merges onto every log entry.
 */
export function getActiveLogContext(): Record<string, string> {
  return getBankMixin();
}

export { capTimeout, isMockTimingActive, MOCK_TIMEOUT_MS } from './MockTiming.js';
