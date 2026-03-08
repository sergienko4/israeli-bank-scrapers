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

function censor(value: unknown, path: string[]): unknown {
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

export function getDebug(name: string): Logger {
  return ROOT_LOGGER.child({ module: name });
}
