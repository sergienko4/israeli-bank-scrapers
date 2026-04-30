import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type Logger } from 'pino';

import {
  AMOUNT_KEYS,
  PII_LABEL,
  SENSITIVE_PATHS,
  WL_SENSITIVE_KEYS,
} from './Config/DebugConfig.js';

/** Async-local store for per-request bank context injected into every log line. */
const BANK_CONTEXT = new AsyncLocalStorage<{ bank: string }>();

/** Maximum value length that bypasses PII masking (preserves last4Digits, displayId). */
const MAX_DISPLAY_LENGTH = 4;

/**
 * Redact sensitive values from log output based on the JSON path.
 * @param value - The value at the sensitive path.
 * @param path - The JSON path segments leading to this value.
 * @returns A censored string replacement.
 */
function censor(value: unknown, path: string[]): string {
  const key = path.at(-1) ?? '';
  const strValue = String(value);
  // Length exception: short display values (last4Digits, account suffixes) are safe
  if (WL_SENSITIVE_KEYS.has(key) && strValue.length > MAX_DISPLAY_LENGTH) return PII_LABEL;
  if (key === 'accountNumber') return '****' + strValue.slice(-4);
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

const ROOT_LOGGER = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isDevMode ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  redact: { paths: SENSITIVE_PATHS, censor },
  mixin: getBankMixin,
});

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
