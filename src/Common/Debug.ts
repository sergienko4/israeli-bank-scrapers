import pino, { type Logger } from 'pino';

// A: Path-based redaction — catches PII in logged JSON objects
const SENSITIVE_PATHS = [
  'password',
  '**.*password', // nested passwords (credentials.password, auth.password, etc.)
  'token',
  '**.*token', // any .token key at any depth
  'auth.calConnectToken',
  'secret',
  'otp',
  'otpCode',
  'id',
  '**.*id', // credentials.id, auth.id, etc.
  'card6Digits',
  '**.*card6Digits',
  '**.*num', // credentials.num, etc.
  'authorization',
  'headers.cookie', // Playwright network logs
  'headers.Authorization',
];

const AMOUNT_KEYS = new Set(['balance', 'originalAmount', 'chargedAmount']);

/**
 * Pino redaction censor function that replaces sensitive field values with masked strings.
 * IAccount numbers are partially masked showing only the last 4 digits; amounts are shown
 * as +*** or -***, and all other sensitive fields are replaced with '[REDACTED]'.
 *
 * @param value - the original field value that is being redacted
 * @param path - the key path within the logged object leading to this value
 * @returns a masked string replacing the original sensitive value
 */
function censor(value: unknown, path: string[]): string {
  const key = path[path.length - 1];
  if (key === 'accountNumber' && value) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return str.length > 4 ? `****${str.slice(-4)}` : '****';
  }
  if (AMOUNT_KEYS.has(key) && typeof value === 'number') {
    return value > 0 ? '+***' : '-***';
  }
  return '[REDACTED]';
}

// B: Regex-based redaction — catches PII in log message strings
const ISRAELI_ID_REGEX = /\b\d{9}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;

const isDevMode =
  process.env.NODE_ENV === 'development' || (!process.env.CI && !process.env.NODE_ENV);

const ROOT_LOGGER = pino({
  level: process.env.LOG_LEVEL ?? 'debug',
  transport: isDevMode
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      }
    : undefined,
  redact: { paths: SENSITIVE_PATHS, censor },
  hooks: {
    /**
     * Pino hook that sanitizes log message strings before they are written,
     * replacing Israeli national ID numbers and credit card numbers with redaction tokens.
     *
     * @param inputArgs - the raw arguments passed to the log method
     * @param method - the underlying pino log method to invoke after sanitizing
     */
    logMethod(inputArgs, method) {
      if (inputArgs.length >= 1 && typeof inputArgs[0] === 'string') {
        inputArgs[0] = inputArgs[0]
          .replace(ISRAELI_ID_REGEX, '[ID_REDACTED]')
          .replace(CREDIT_CARD_REGEX, '[CARD_REDACTED]');
      }
      method.apply(this, inputArgs);
    },
  },
});

export type ScraperLogger = Logger;

/**
 * Creates a child pino logger scoped to the given module name.
 * The logger automatically redacts PII fields and sanitizes message strings.
 *
 * @param name - the module identifier used as the `module` field in every log entry
 * @returns a scoped pino Logger instance
 */
export function getDebug(name: string): Logger {
  return ROOT_LOGGER.child({ module: name });
}
