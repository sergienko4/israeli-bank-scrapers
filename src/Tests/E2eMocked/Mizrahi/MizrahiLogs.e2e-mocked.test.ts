/**
 * Mizrahi browserless login — no credential, cookie, token or bank text
 * reaches a log line. Every pipeline logger is swapped for a real pino logger
 * at `trace` level with the production redaction config, so full runs and
 * failures are observed at full verbosity.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { PassThrough } from 'node:stream';

import { jest } from '@jest/globals';
import pino, { type Logger, type LoggerOptions } from 'pino';

import {
  getActiveLogContext,
  runWithBankContext,
} from '../../../Scrapers/Pipeline/Logging/BankContext.js';
import { buildSilentOptions } from '../../../Scrapers/Pipeline/Logging/RootLogger.js';
import {
  MIZRAHI_MOCK_CREDS,
  MZ_AUTH_COOKIE,
  MZ_LOGON_XSRF,
  MZ_SKYSERID,
  MZ_WEB_SESSION,
  MZ_XSRF_DECODED,
  MZ_XSRF_RAW,
} from './MizrahiMockData.js';

/** Every serialized log line any pipeline module emitted. */
const LOG_LINES: string[] = [];

/**
 * Real pino logger at `trace`, production redaction, deterministic output.
 * @param production - Production pino options (redaction + mixin).
 * @returns Logger whose lines land in {@link LOG_LINES}.
 */
function makeCapturingLogger(production: LoggerOptions): Logger {
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer): number => {
    const line = chunk.toString();
    return LOG_LINES.push(line);
  });
  const options = { ...production, level: 'trace', timestamp: false, base: undefined };
  return pino(options, stream);
}

// The logger modules are imported statically, never inside this factory: the
// factory runs while the module graph is still linking, and a dynamic import of
// RootLogger's PiiRedactor graph from here races that link on Node 22.
jest.unstable_mockModule('../../../Scrapers/Pipeline/Logging/Debug.js', () => {
  const production = buildSilentOptions();
  const logger = makeCapturingLogger(production);
  /**
   * Every pipeline module shares the capturing logger.
   * @returns The capturing logger.
   */
  const getDebug = (): Logger => logger;
  return { getActiveLogContext, runWithBankContext, getDebug, getDebugByName: getDebug };
});

const { MZ_BANK_NOTICE } = await import('./MizrahiFetchMock.js');
const MIZRAHI_RUN = await import('./MizrahiRun.js');

/**
 * The value half of a cookie pair.
 * @param pair - A `name=value` cookie pair.
 * @returns The value.
 */
function cookieValueOf(pair: string): string {
  const valueStart = pair.indexOf('=') + 1;
  return pair.slice(valueStart);
}

/** Every synthetic secret the bank or the caller hands the scraper. */
const SECRETS: readonly string[] = [
  MIZRAHI_MOCK_CREDS.username,
  MIZRAHI_MOCK_CREDS.password,
  MZ_XSRF_RAW,
  MZ_XSRF_DECODED,
  MZ_LOGON_XSRF,
  MZ_SKYSERID,
  cookieValueOf(MZ_AUTH_COOKIE),
  cookieValueOf(MZ_WEB_SESSION),
  MZ_BANK_NOTICE,
];

describe('Mizrahi browserless logs', () => {
  beforeEach((): void => {
    LOG_LINES.length = 0;
  });

  it.each(['none', 'expire401', 'changeAccount500', 'logonNoXsrf'] as const)(
    'logs no secret on a %s run',
    async fault => {
      await MIZRAHI_RUN.runMizrahi(fault);
      const emitted = LOG_LINES.join('');
      const leaked = SECRETS.filter(secret => emitted.includes(secret));
      expect(LOG_LINES.length).toBeGreaterThan(0);
      expect(leaked).toEqual([]);
    },
  );
});
