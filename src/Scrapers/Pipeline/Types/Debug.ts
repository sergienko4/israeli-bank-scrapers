import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type Logger } from 'pino';

import { AMOUNT_KEYS, PII_LABEL, SENSITIVE_PATHS, WL_SENSITIVE_KEYS } from './DebugConfig.js';

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

const isDevMode = !process.env.CI && process.env.NODE_ENV !== 'production';

/**
 * Inject bank context from AsyncLocalStorage into every log line.
 * @returns The current bank context or an empty object.
 */
function getBankMixin(): Record<BankName, BankName> {
  return BANK_CONTEXT.getStore() ?? {};
}

/** Pino transport for dev mode (pretty printing). */
const DEV_TRANSPORT = { target: 'pino-pretty', options: { colorize: true } };

const ROOT_LOGGER = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDevMode && { transport: DEV_TRANSPORT }),
  redact: {
    paths: SENSITIVE_PATHS,
    censor: censor as (v: unknown, p: PathSegment[]) => MaskedValue,
  },
  mixin: getBankMixin,
});

export type ScraperLogger = Logger;

/**
 * Create a child logger scoped to a specific module.
 * @param name - The module name for log context.
 * @returns A pino Logger child instance.
 */
export function getDebug(name: LoggerName): Logger {
  return ROOT_LOGGER.child({ module: name });
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
