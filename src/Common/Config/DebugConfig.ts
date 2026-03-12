/** JSON paths to redact from pino log output. */
export const SENSITIVE_PATHS = [
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

/** Field names whose values are monetary amounts (masked to sign-only in logs). */
export const AMOUNT_KEYS = new Set(['balance', 'originalAmount', 'chargedAmount']);
