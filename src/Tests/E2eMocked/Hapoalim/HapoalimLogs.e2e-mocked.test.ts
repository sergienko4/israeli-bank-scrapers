/**
 * Hapoalim HTTP-only logs — no credential, code, cookie, phone or bank text
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
import type { HapoalimFault } from './HapoalimFaults.js';
import { HP_BANK_NOTICE } from './HapoalimFaults.js';
import {
  HAPOALIM_MOCK_CREDS,
  HP_AUTH_COOKIE,
  HP_BOOT_COOKIE,
  HP_CSRF_DECODED,
  HP_CSRF_RAW,
  HP_FRESH_AUTH_COOKIE,
  HP_OTP,
  HP_PHONE,
  HP_REFUSED_COOKIE,
  HP_XSRF_DECODED,
  HP_XSRF_RAW,
} from './HapoalimMockData.js';

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

const HAPOALIM_RUN = await import('./HapoalimRun.js');
const WARM_TOKENS = await import('./HapoalimWarmTokens.js');

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
  HAPOALIM_MOCK_CREDS.password,
  HP_OTP,
  HP_PHONE,
  HP_XSRF_RAW,
  HP_XSRF_DECODED,
  HP_CSRF_RAW,
  HP_CSRF_DECODED,
  cookieValueOf(HP_BOOT_COOKIE),
  cookieValueOf(HP_AUTH_COOKIE),
  cookieValueOf(HP_FRESH_AUTH_COOKIE),
  cookieValueOf(HP_REFUSED_COOKIE),
  HP_BANK_NOTICE,
];

/**
 * Scrape with a stored token.
 * @param token - The token handed to the run.
 * @param fault - How the bank misbehaves.
 * @returns Resolves once the run ends.
 */
async function runWarm(token: string, fault: HapoalimFault = 'none'): Promise<void> {
  await HAPOALIM_RUN.runHapoalim(fault, { creds: { otpLongTermToken: token } });
}

/**
 * Every secret a run's logs held.
 * @param secrets - Values that must not appear.
 * @returns The ones that did.
 */
function leakedOf(secrets: readonly string[]): readonly string[] {
  const emitted = LOG_LINES.join('');
  return secrets.filter(secret => emitted.includes(secret));
}

describe('Hapoalim browserless logs', () => {
  beforeEach((): void => {
    LOG_LINES.length = 0;
  });

  it.each(['none', 'expire401', 'verifyErrors', 'otpVerifyErrors', 'landingErrors'] as const)(
    'logs no secret on a %s run',
    async fault => {
      await HAPOALIM_RUN.runHapoalim(fault);
      const leaked = leakedOf(SECRETS);
      expect(LOG_LINES.length).toBeGreaterThan(0);
      expect(leaked).toEqual([]);
    },
  );

  describe('with a stored token', () => {
    const cold = { token: '' };

    beforeAll(async (): Promise<void> => {
      const run = await HAPOALIM_RUN.runHapoalim();
      cold.token = run.result.persistentOtpToken ?? '';
    });

    it.each(['none', 'sessionExpired'] as const)(
      'logs neither a secret nor the token on a warm %s run',
      async fault => {
        await runWarm(cold.token, fault);
        const leaked = leakedOf([...SECRETS, cold.token]);
        expect(cold.token).not.toBe('');
        expect(leaked).toEqual([]);
      },
    );

    it.each(WARM_TOKENS.STALE_TOKENS)('names why it skips $label, never the token', async stale => {
      const token = stale.build(cold.token);
      await runWarm(token);
      const emitted = LOG_LINES.join('');
      const leaked = leakedOf([token]);
      expect(emitted).toContain(stale.logged);
      expect(leaked).toEqual([]);
    });
  });
});
