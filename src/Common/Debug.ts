import pino, { type Logger } from 'pino';

const SENSITIVE_PATHS = [
  'password',
  'credentials.password',
  'token',
  'auth.token',
  'auth.calConnectToken',
  'secret',
  'otp',
  'otpCode',
  'id',
  'credentials.id',
  'card6Digits',
  'credentials.card6Digits',
  'credentials.num',
  'authorization',
];

const AMOUNT_KEYS = new Set(['balance', 'originalAmount', 'chargedAmount']);

/**
 * Redact sensitive values from log output based on the JSON path.
 * @param value - The value at the sensitive path.
 * @param path - The JSON path segments leading to this value.
 * @returns A censored string replacement.
 */
function censor(value: unknown, path: string[]): string {
  const key = path[path.length - 1];
  if (key === 'accountNumber') return '****' + String(value).slice(-4);
  if (AMOUNT_KEYS.has(key)) return (value as number) > 0 ? '+***' : '-***';
  return '[REDACTED]';
}

const isDevMode = !process.env.CI && process.env.NODE_ENV !== 'production';

const ROOT_LOGGER = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isDevMode ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  redact: { paths: SENSITIVE_PATHS, censor },
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
