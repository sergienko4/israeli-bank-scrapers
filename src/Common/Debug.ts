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

function censor(value: unknown, path: string[]): unknown {
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

export function getDebug(name: string): Logger {
  return ROOT_LOGGER.child({ module: name });
}
