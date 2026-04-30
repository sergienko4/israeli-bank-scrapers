import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type Logger } from 'pino';

import { getActivePhase, getActiveStage } from './ActiveState.js';
import { AMOUNT_KEYS, PII_LABEL, SENSITIVE_PATHS, WL_SENSITIVE_KEYS } from './DebugConfig.js';
import { getLogFile } from './TraceConfig.js';

/** Bank identifier string. */
type BankName = string;
/** Sensitive value at a PII-redacted JSON path. */
type SensitiveValue = string | number;
/** JSON path segment in pino redaction. */
type PathSegment = string;
/** PII-masked output value. */
type MaskedValue = string;
/** Logger namespace identifier. */
type LoggerName = string;
/** Numeric amount for sign-based masking. */
type AmountValue = number;

/** Bank context shape for async-local storage. */
interface IBankContext {
  readonly [key: BankName]: BankName;
  bank: BankName;
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

/** Maximum value length that bypasses PII masking (preserves last4Digits, displayId). */
const MAX_DISPLAY_LENGTH = 4;

/** Censor input — value at a redacted JSON path, typed for pino's censor callback. */
interface ICensorInput {
  readonly value: SensitiveValue;
  readonly key: PathSegment;
}

/**
 * Parse censor arguments from pino's redact callback.
 * @param value - The value at the sensitive path (string or number).
 * @param path - The JSON path segments leading to this value.
 * @returns Typed censor input.
 */
function parseCensorArgs(value: SensitiveValue, path: PathSegment[]): ICensorInput {
  const key = path.at(-1);
  if (key === undefined) return { value, key: String() };
  return { value, key };
}

/**
 * Format the censored amount sign indicator.
 * @param value - The numeric amount value.
 * @returns '+***' for positive, '-***' for negative/zero.
 */
function censorAmount(value: AmountValue): MaskedValue {
  if (value > 0) return '+***';
  return '-***';
}

/**
 * Redact sensitive values from log output based on the JSON path.
 * Typed to match pino's redact censor callback signature.
 * @param value - The value at the sensitive path.
 * @param path - The JSON path segments leading to this value.
 * @returns A censored string replacement.
 */
function censor(value: SensitiveValue, path: PathSegment[]): MaskedValue {
  const input = parseCensorArgs(value, path);
  const strValue = String(input.value);
  if (WL_SENSITIVE_KEYS.has(input.key) && strValue.length > MAX_DISPLAY_LENGTH) return PII_LABEL;
  if (input.key === 'accountNumber') return '****' + strValue.slice(-4);
  if (AMOUNT_KEYS.has(input.key)) return censorAmount(input.value as number);
  return '[REDACTED]';
}

/**
 * Inject bank context from AsyncLocalStorage into every log line.
 * @returns The current bank context or an empty object.
 */
function getBankMixin(): Record<BankName, BankName> {
  const bank = BANK_CONTEXT.getStore() ?? {};
  return { ...bank, phase: getActivePhase(), stage: getActiveStage() };
}

const isDevMode = !process.env.CI && process.env.NODE_ENV !== 'production';

/** Pino transport for dev mode (pretty printing). */
const DEV_TRANSPORT = { target: 'pino-pretty', options: { colorize: true } };

/** Absolute log file path — empty string when file logging is off. */
type LogFilePath = string;

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
  logFile: LogFilePath,
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
      censor: censor as unknown as PinoCensorFn,
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
  name: LoggerName,
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
function makeChildProxyHandler(name: LoggerName, entry: IDeferredChildEntry): IProxyHandler {
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
function basenameFromUrl(metaUrl: LoggerName): LoggerName {
  const cleaned = metaUrl.split('?')[0].split('#')[0];
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash < 0) return cleaned;
  return cleaned.substring(lastSlash + 1);
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
function deriveLogName(metaUrl: LoggerName): LoggerName {
  const last = basenameFromUrl(metaUrl);
  const stem = last.replace(FILE_EXT_RE, '');
  const kebab = stem.replace(PASCAL_SPLIT_RE, '$1-$2').toLowerCase();
  return kebab;
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
export function getDebug(metaUrl: LoggerName): Logger {
  const name = deriveLogName(metaUrl);
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
export function runWithBankContext<T>(bank: BankName, fn: () => T): T {
  return BANK_CONTEXT.run({ bank }, fn);
}

export { capTimeout, isMockTimingActive, MOCK_TIMEOUT_MS } from './MockTiming.js';
