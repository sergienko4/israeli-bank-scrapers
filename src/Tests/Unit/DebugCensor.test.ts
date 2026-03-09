import pino from 'pino';
import { PassThrough } from 'stream';

import { getDebug } from '../../Common/Debug.js';

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
 * Mirrors the censor function from Debug.ts for testing purposes.
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

/**
 * Create a pino logger that writes JSON to a buffer for assertion.
 * @returns Object with logger and getOutput function.
 */
function createTestLogger(): { sink: pino.Logger; getOutput: () => string } {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const sink = pino({ level: 'info', redact: { paths: SENSITIVE_PATHS, censor } }, stream);
  return {
    sink,
    /**
     * Retrieve the accumulated log output.
     * @returns the output string.
     */
    getOutput: (): string => output,
  };
}

describe('censor — PII redaction via pino', () => {
  it('redacts top-level password to [REDACTED]', () => {
    const { sink, getOutput } = createTestLogger();
    sink.info({ password: 'my-secret-pass' }, 'login attempt');
    const output = getOutput();
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('my-secret-pass');
  });

  it('redacts nested credentials.password', () => {
    const { sink, getOutput } = createTestLogger();
    sink.info({ credentials: { password: 'nested-pass' } }, 'nested');
    const output = getOutput();
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('nested-pass');
  });

  it('redacts token fields to [REDACTED]', () => {
    const { sink, getOutput } = createTestLogger();
    sink.info({ token: 'abc-jwt-token-123' }, 'token check');
    const output = getOutput();
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('abc-jwt-token-123');
  });

  it('redacts otp to [REDACTED]', () => {
    const { sink, getOutput } = createTestLogger();
    sink.info({ otp: '654321' }, 'otp sent');
    const output = getOutput();
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('654321');
  });

  it('redacts authorization header to [REDACTED]', () => {
    const { sink, getOutput } = createTestLogger();
    sink.info({ authorization: 'Bearer xyz' }, 'api call');
    const output = getOutput();
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('Bearer xyz');
  });

  it('redacts id and card6Digits', () => {
    const { sink, getOutput } = createTestLogger();
    sink.info({ id: '314076571', card6Digits: '768912' }, 'card data');
    const output = getOutput();
    expect(output).not.toContain('314076571');
    expect(output).not.toContain('768912');
  });

  it('does not redact non-sensitive fields', () => {
    const { sink, getOutput } = createTestLogger();
    sink.info({ merchantName: 'SuperMarket', trnAmt: 150 }, 'transaction');
    const output = getOutput();
    expect(output).toContain('SuperMarket');
    expect(output).toContain('150');
  });
});

describe('getDebug — logger creation', () => {
  it('returns a logger with all standard log methods', () => {
    const logger = getDebug('test-debug');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('returns distinct child loggers for different names', () => {
    const logA = getDebug('module-a');
    const logB = getDebug('module-b');
    expect(logA).not.toBe(logB);
  });

  it('child logger handles structured data without throwing', () => {
    const childLog = getDebug('structured-test');
    expect(() => {
      childLog.info({ step: 'login', elapsed: 123 }, 'step done');
    }).not.toThrow();
  });
});
