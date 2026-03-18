import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type Logger } from 'pino';

import { AMOUNT_KEYS, SENSITIVE_PATHS } from './Config/DebugConfig.js';

/** Async-local store for per-request bank context injected into every log line. */
const BANK_CONTEXT = new AsyncLocalStorage<{ bank: string }>();

/**
 * Redact sensitive values from log output based on the JSON path.
 * @param value - The value at the sensitive path.
 * @param path - The JSON path segments leading to this value.
 * @returns A censored string replacement.
 */
export function censor(value: unknown, path: string[]): string {
  const key = path[path.length - 1];
  if (key === 'accountNumber') return '****' + String(value).slice(-4);
  if (AMOUNT_KEYS.has(key)) return (value as number) > 0 ? '+***' : '-***';
  return '[REDACTED]';
}

const isDevMode = !process.env.CI && process.env.NODE_ENV !== 'production';

/**
 * Inject bank context from AsyncLocalStorage into every log line.
 * @returns The current bank context or an empty object.
 */
function getBankMixin(): Record<string, string> {
  return BANK_CONTEXT.getStore() ?? {};
}

/** Shared pino options for both logger configurations. */
const PINO_BASE_OPTS = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: SENSITIVE_PATHS, censor },
  mixin: getBankMixin,
};

/**
 * Create the root logger — with file tee if PINO_LOG_FILE is set.
 * @returns A configured pino Logger instance.
 */
function createRootLogger(): Logger {
  const logFile = process.env.PINO_LOG_FILE;
  if (logFile && !isDevMode) {
    const streamLevel = process.env.LOG_LEVEL ?? 'info';
    const dest = pino.multistream([
      { stream: pino.destination(1), level: streamLevel },
      { stream: pino.destination(logFile), level: streamLevel },
    ]);
    return pino(PINO_BASE_OPTS, dest);
  }
  return pino({
    ...PINO_BASE_OPTS,
    transport: isDevMode ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  });
}

const ROOT_LOGGER = createRootLogger();

export type ScraperLogger = Logger;

/**
 * Create a child logger scoped to a specific module.
 * @param name - The module name for log context.
 * @returns A pino Logger child instance.
 */
export function getDebug(name: string): Logger {
  return ROOT_LOGGER.child({ module: name });
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
