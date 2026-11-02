/**
 * Beinleumi browserless logs, caller outcomes (AD-N12) — no password, code,
 * user or account name, Transmit token, authorization, envelope key, device or
 * session id, SSO code, cookie, bank text or opaque device state reaches a log
 * line or a failure message, across the wrong-credential, SMS-outcome and
 * device-memory runs. Every pipeline logger is swapped for a real pino logger
 * at `trace` with the production redaction config. The scrape receives only
 * the authorization and the landing page: no other login value rides on a BFF
 * read, and it sends only the cookies the portal set. The bank-fault runs live
 * in BeinleumiLogsFaults; the split lets the two suites run on separate workers.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { jest } from '@jest/globals';

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { capturingDebugModule, LOG_LINES } from './BeinleumiLogCapture.js';

jest.unstable_mockModule('../../../Scrapers/Pipeline/Logging/Debug.js', capturingDebugModule);

const BRANDS = await import('./BeinleumiBrands.js');
const DATA = await import('./BeinleumiMockData.js');
const FETCH_MOCK = await import('./BeinleumiFetchMock.js');
const ORACLE = await import('./BeinleumiLogOracle.js');
const RUN = await import('./BeinleumiRun.js');

/** What every BFF read must carry from the login: the authorization and the landing page. */
const CARRY = {
  authorization: DATA.BN_AUTHORIZATION,
  referer: BRANDS.landingUrlOf(BRANDS.BEINLEUMI_MOCK_BRAND),
};

/** The BFF reads one account's scrape makes. */
const SCRAPE_READS = RUN.SCRAPE_TRAIL.length;

/**
 * Whether a call is a BFF read the scrape made.
 * @param call - The call.
 * @returns True for a data call.
 */
function isDataCall(call: IRecordedCall): boolean {
  return FETCH_MOCK.classifyBeinleumi(call) === 'graphql';
}

/**
 * The session values a BFF read carries: its authorization and its sender.
 * @param call - The read.
 * @returns Both header values ('' when absent).
 */
function carriedOf(call: IRecordedCall): Readonly<Record<string, string>> {
  const authorization = call.headers.get('authorization') ?? '';
  const referer = call.headers.get('referer') ?? '';
  return { authorization, referer };
}

/**
 * What a BFF read sent: its URL, every header (cookies too) and its body.
 * @param call - The read.
 * @returns The sent values as one text.
 */
function sentTextOf(call: IRecordedCall): string {
  const headers = [...call.headers.entries()];
  return JSON.stringify({ url: call.url, headers, body: call.body });
}

describe('Beinleumi browserless logs on caller outcomes (AD-N12)', () => {
  beforeEach((): void => {
    LOG_LINES.length = 0;
  });

  it.each(ORACLE.OUTCOME_RUNS)(
    'logs and reports no secret on the $label run',
    async ({ fault, setup, states }) => {
      const run = await RUN.runBeinleumi(fault, setup);
      const leaks = ORACLE.leaksOf(run, LOG_LINES);
      const held = ORACLE.statesOf(run);
      expect(run.state.violations).toEqual([]);
      expect(LOG_LINES.length).toBeGreaterThan(0);
      expect(held).toHaveLength(states);
      expect(leaks).toEqual({ logged: [], reported: [] });
    },
  );

  it('notes the stored device id kept over the one the bank answered, by slot only', async () => {
    await RUN.runBeinleumi('none', ORACLE.RESUME);
    const emitted = LOG_LINES.join('');
    const leaked = ORACLE.leakedIn(emitted, [DATA.BN_DID, DATA.BN_STORED_DID]);
    expect(emitted).toContain('"slot":"did","kept":true');
    expect(leaked).toEqual([]);
  });

  it('observes the sealed login steps at trace level', async () => {
    await RUN.runBeinleumi('otpGenerate');
    const emitted = LOG_LINES.join('');
    expect(emitted).toContain('[runStep] envelope opened');
    expect(emitted).toContain('"stepName":"assertOtp"');
  });

  it.each(['none', 'otpSidRefresh'] as const)(
    'hands the scrape only the authorization, the landing page and the portal cookies on the %s run',
    async fault => {
      const run = await RUN.runBeinleumi(fault, ORACLE.RESUME);
      const reads = run.calls.filter(isDataCall);
      const carried = reads.map(carriedOf);
      const cookieNames = reads.map(ORACLE.cookieNamesOf);
      const sent = reads.map(sentTextOf).join('');
      const envelope = ORACLE.envelopeOf(run);
      const states = ORACLE.statesOf(run);
      const leaked = ORACLE.leakedIn(sent, [...ORACLE.LOGIN_SECRETS, ...envelope, ...states]);
      const expectedCarry = reads.map(() => CARRY);
      const expectedCookies = reads.map(() => ORACLE.PORTAL_COOKIE_NAMES);
      expect(reads).toHaveLength(SCRAPE_READS);
      expect(carried).toEqual(expectedCarry);
      expect(cookieNames).toEqual(expectedCookies);
      expect(leaked).toEqual([]);
    },
  );
});
