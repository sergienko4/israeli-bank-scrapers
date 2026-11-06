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

/** Every synthetic secret the bank hands the scraper. */
const BANK_SECRETS: readonly string[] = [
  DATA.DC_UID,
  DATA.DC_XSRF_RAW,
  DATA.DC_XSRF_DECODED,
  DATA.DC_XSRF_ROTATED_RAW,
  DATA.DC_XSRF_ROTATED,
  DATA.DC_TUUID,
  cookieValueOf(DATA.DC_SESSION_COOKIE),
  DATA.DC_MI6,
  DATA.DC_MI6_MISMATCH,
  FAULTS.DC_BANK_NOTICE,
];

/**
 * The Titan account ids the per-account read URLs embed in their path — each
 * must reach a log only as {@link import('./DiscountMockData.js').DISCOUNT_MOCK_ACCOUNTS}
 * redacted, never as itself.
 */
const ACCOUNT_IDS: readonly string[] = DATA.DISCOUNT_MOCK_ACCOUNTS.map(account => account.id);

/**
 * Every secret one run must keep out of its logs: its own credentials, then
 * the bank's, then the account ids the read URLs carry.
 * @param creds - The credentials the run logs in with.
 * @returns The secrets.
 */
function secretsOf(creds: Readonly<Record<string, string>>): readonly string[] {
  const own = Object.values(creds);
  return [...own, ...BANK_SECRETS, ...ACCOUNT_IDS];
}

/** Runs whose every log line is checked: a full run, then each kind of refusal. */
const RUNS = [
  ['a full run', 'none', CREDS],
  ['a wrong password', 'none', { ...CREDS, password: 'synthetic-wrong-pass' }],
  ['a step-up', 'actionRequired', CREDS],
  ['a login bound to another id', 'mi6Mismatch', CREDS],
  ['a malformed redirect token', 'malformedHopXsrf', CREDS],
  ['a Titan error', 'titanError', CREDS],
  ['a Titan HTTP failure', 'titan500', CREDS],
] as const;

describe('Discount browserless logs', () => {
  beforeEach((): void => {
    LOG_LINES.length = 0;
  });

  it.each(RUNS)('logs no secret on %s', async (_name, fault, creds) => {
    await RUN.runDiscount(fault, { ...creds });
    const emitted = LOG_LINES.join('');
    const secrets = secretsOf(creds);
    const leaked = secrets.filter(secret => emitted.includes(secret));
    expect(LOG_LINES.length).toBeGreaterThan(0);
    expect(leaked).toEqual([]);
  });
});
