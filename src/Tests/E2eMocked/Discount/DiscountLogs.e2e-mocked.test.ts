/**
 * Discount browserless logs — no credential, formatted id, token, session
 * id, cookie, login binding or bank text reaches a log line, across a full
 * run and every refusal. Every pipeline logger is swapped for a real pino
 * logger at `trace` with the production redaction config.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { jest } from '@jest/globals';

import { capturingDebugModule, LOG_LINES } from '../Helpers/LogCapture.js';

jest.unstable_mockModule('../../../Scrapers/Pipeline/Logging/Debug.js', capturingDebugModule);

const DATA = await import('./DiscountMockData.js');
const FAULTS = await import('./DiscountFaults.js');
const RUN = await import('./DiscountRun.js');

/**
 * The value half of a cookie pair.
 * @param pair - A `name=value` cookie pair.
 * @returns The value.
 */
function cookieValueOf(pair: string): string {
  const valueStart = pair.indexOf('=') + 1;
  return pair.slice(valueStart);
}

const CREDS = DATA.DISCOUNT_MOCK_CREDS;

/** Every synthetic secret the bank or the caller hands the scraper. */
const SECRETS: readonly string[] = [
  CREDS.id,
  DATA.DC_UID,
  CREDS.password,
  CREDS.num,
  DATA.DC_XSRF_RAW,
  DATA.DC_XSRF_DECODED,
  DATA.DC_XSRF_ROTATED_RAW,
  DATA.DC_XSRF_ROTATED,
  DATA.DC_TUUID,
  cookieValueOf(DATA.DC_SESSION_COOKIE),
  DATA.DC_MI6,
  FAULTS.DC_BANK_NOTICE,
];

/** Runs whose every log line is checked: a full run, then each kind of refusal. */
const RUNS = [
  ['a full run', 'none', CREDS],
  ['a wrong password', 'none', { ...CREDS, password: 'synthetic-wrong-pass' }],
  ['a step-up', 'actionRequired', CREDS],
  ['a login bound to another id', 'mi6Mismatch', CREDS],
  ['a malformed redirect token', 'malformedHopXsrf', CREDS],
  ['a Titan error', 'titanError', CREDS],
] as const;

describe('Discount browserless logs', () => {
  beforeEach((): void => {
    LOG_LINES.length = 0;
  });

  it.each(RUNS)('logs no secret on %s', async (_name, fault, creds) => {
    await RUN.runDiscount(fault, { ...creds });
    const emitted = LOG_LINES.join('');
    const leaked = SECRETS.filter(secret => emitted.includes(secret));
    expect(LOG_LINES.length).toBeGreaterThan(0);
    expect(leaked).toEqual([]);
  });
});
