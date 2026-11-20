/**
 * Ring issuers' HTTP-only login (Isracard, Amex) — mocked-ring E2E, run
 * once per issuer against the synthetic ring playing that issuer, for what
 * the shared
 * API-DIRECT flow spec cannot see: the six-step device-key login, the
 * session cookie and bcKey riding on every data call, the password
 * staying off the warm path, the one cold
 * re-login after an expired warm session, a card row with no card number
 * or a refused month failing the run instead of reading as empty, and every
 * way the login can fail.
 * The happy cold and warm runs also live in ApiDirectFlow.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
} from '../../../Scrapers/Base/Interface.js';
import {
  decodeWarmBundle,
  encodeWarmBundle,
} from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCarryBundle.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { parseBody } from '../Helpers/FetchMockKit.js';
import createScraperWithMtls from '../Helpers/MtlsScraper.js';
import type { IRingTarget, RingFault } from './RingFetchMock.js';
import {
  AMEX_RING_TARGET,
  installRingFetchMock,
  ISRACARD_RING_TARGET,
  RING_DATA_STEPS,
  RING_MOCK_CARDS,
  RING_MOCK_CREDS,
  RING_MOCK_START_DATE,
  ringBcKey,
  ringStepOf,
  SYN_DEVICE_UDID,
  SYN_ISSUED_KEY,
  SYN_STORED_KEY,
} from './RingFetchMock.js';

/** An issuer under test: the bank to scrape and the ring it signs in to. */
interface IRingIssuer {
  readonly bank: string;
  readonly companyId: CompanyTypes;
  readonly target: IRingTarget;
}

const ISSUERS: readonly IRingIssuer[] = [
  { bank: 'Isracard', companyId: CompanyTypes.Isracard, target: ISRACARD_RING_TARGET },
  { bank: 'Amex', companyId: CompanyTypes.Amex, target: AMEX_RING_TARGET },
];

/** A decoded warm carry bundle. */
type PersistedBundle = Extract<ReturnType<typeof decodeWarmBundle>, { success: true }>['value'];

/** What one mocked run produced. */
interface IRingRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  /** The ring route of each login call, in order. */
  readonly steps: readonly string[];
  /** Every card-list and transactions call. */
  readonly data: readonly IRecordedCall[];
}

const VALIDATE = 'ValidateIdDataNoReg';
const LOGON = 'performNewLogon';
const DEVICE_KEY = 'CustomerValidateKeyOtp/9';
const REGISTER = 'CustomerDataRegistration';
const RESUME = 'CustomerValidateKeyOtp/4';
const SESSION_TOKEN = 'performLogonOtp';

/** A cold login: check the id and password, register a key, sign in with it. */
const COLD_STEPS = [VALIDATE, LOGON, DEVICE_KEY, REGISTER, RESUME, SESSION_TOKEN];

/** A warm login: sign in with the stored key. */
const WARM_STEPS = [RESUME, SESSION_TOKEN];

/**
 * Whether a call fetched cards or transactions.
 * @param call - A recorded call.
 * @returns True for a data call.
 */
function isDataCall(call: IRecordedCall): boolean {
  const step = ringStepOf(call);
  return RING_DATA_STEPS.has(step);
}

/**
 * Split a call log into its login steps and data calls.
 * @param calls - The run's call log.
 * @returns The login route names and the data calls.
 */
function splitCalls(calls: readonly IRecordedCall[]): Pick<IRingRun, 'steps' | 'data'> {
  const logins = calls.filter(call => !isDataCall(call));
  const data = calls.filter(isDataCall);
  return { steps: logins.map(ringStepOf), data };
}

/** One mocked run: the issuer, its credentials and the fault the ring answers with. */
interface IRingRunArgs {
  readonly issuer: IRingIssuer;
  readonly creds: ScraperCredentials;
  readonly fault?: RingFault;
}

/**
 * Scrape an issuer against the synthetic ring playing it.
 * @param args - Issuer, credentials and fault.
 * @returns The result and the call log.
 */
async function runRing(args: IRingRunArgs): Promise<IRingRun> {
  const handle = installRingFetchMock(args.issuer.target, args.fault);
  try {
    const result = await scrapeRing(handle, args.issuer.companyId, args.creds);
    const calls = handle.calls();
    return { result, calls, ...splitCalls(calls) };
  } finally {
    handle.dispose();
  }
}

/**
 * Run one scrape against an installed ring mock.
 * @param handle - Installed mock.
 * @param companyId - Issuer to scrape.
 * @param creds - Synthetic credentials.
 * @returns The scrape result.
 */
async function scrapeRing(
  handle: ReturnType<typeof installRingFetchMock>,
  companyId: CompanyTypes,
  creds: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const options = { companyId, startDate: RING_MOCK_START_DATE };
  const scraper = createScraperWithMtls(options, { fallback: handle.mtlsFallback });
  return scraper.scrape(creds);
}

/**
 * Run a cold scrape, then a warm scrape with its token on the same mock.
 * @param issuer - Issuer under test.
 * @returns Both runs, each with its own call log.
 */
async function runColdThenWarm(
  issuer: IRingIssuer,
): Promise<{ readonly cold: IRingRun; readonly warm: IRingRun }> {
  const handle = installRingFetchMock(issuer.target);
  try {
    return await runPair(handle, issuer);
  } finally {
    handle.dispose();
  }
}

/**
 * Run cold then warm on one installed mock.
 * @param handle - Installed mock.
 * @param issuer - Issuer under test.
 * @returns Both packed runs.
 */
async function runPair(
  handle: ReturnType<typeof installRingFetchMock>,
  issuer: IRingIssuer,
): Promise<{ readonly cold: IRingRun; readonly warm: IRingRun }> {
  const coldResult = await scrapeRing(handle, issuer.companyId, { ...RING_MOCK_CREDS });
  const splitAt = handle.calls().length;
  const token = coldResult.persistentOtpToken ?? '';
  const warmCreds = { ...RING_MOCK_CREDS, otpLongTermToken: token };
  const warmResult = await scrapeRing(handle, issuer.companyId, warmCreds);
  const calls = handle.calls();
  const coldCalls = calls.slice(0, splitAt);
  const warmCalls = calls.slice(splitAt);
  return { cold: packRun(coldResult, coldCalls), warm: packRun(warmResult, warmCalls) };
}

/**
 * Pack one result and its calls into a run record.
 * @param result - Scrape result.
 * @param calls - Calls made by that run.
 * @returns The packed run.
 */
function packRun(result: IScraperScrapingResult, calls: readonly IRecordedCall[]): IRingRun {
  return { result, calls, ...splitCalls(calls) };
}

/**
 * Whether any request body carries a value.
 * @param calls - The run's call log.
 * @param value - Value to look for.
 * @returns True when some body contains it.
 */
function isSent(calls: readonly IRecordedCall[], value: string): boolean {
  return calls.some(call => call.body.includes(value));
}

/**
 * The device id a cold run registered its key under.
 * @param calls - The run's call log.
 * @returns The UDID of the registration body; empty when none was sent.
 */
function registeredUdid(calls: readonly IRecordedCall[]): string {
  const registration = calls.find(call => ringStepOf(call) === REGISTER);
  if (registration === undefined) return '';
  const body = parseBody(registration.body);
  return String(body.UDID);
}

/** A stored key with a line break — refused before it reaches the wire. */
const MALFORMED_TOKEN = 'syn-malformed\r\ntoken';

/** A login the ring refuses: the input, the failure and the steps it took. */
interface IRefusal {
  readonly name: string;
  readonly creds: ScraperCredentials;
  readonly fault: RingFault;
  readonly errorType: ScraperErrorTypes;
  readonly steps: readonly string[];
}

const SAME_CREDS = { ...RING_MOCK_CREDS };

/** Refused logins and the failure each must surface, before any data call. */
const REFUSALS: readonly IRefusal[] = [
  {
    name: 'a wrong password',
    creds: { ...RING_MOCK_CREDS, password: 'synthetic-wrong-pass' },
    fault: 'none',
    errorType: ScraperErrorTypes.InvalidPassword,
    steps: [VALIDATE, LOGON],
  },
  {
    name: 'unknown card digits',
    creds: { ...RING_MOCK_CREDS, card6Digits: '654321' },
    fault: 'none',
    errorType: ScraperErrorTypes.InvalidPassword,
    steps: [VALIDATE],
  },
  {
    name: 'a password the ring wants changed',
    creds: SAME_CREDS,
    fault: 'changePassword',
    errorType: ScraperErrorTypes.ChangePassword,
    steps: [VALIDATE],
  },
  {
    name: 'an expired password',
    creds: SAME_CREDS,
    fault: 'passwordExpired',
    errorType: ScraperErrorTypes.ChangePassword,
    steps: [VALIDATE, LOGON],
  },
];

/** Step-0 faults and the failure each must surface, with no response text. */
const STEP_ZERO_FAULTS: readonly (readonly [RingFault, ScraperErrorTypes, string])[] = [
  ['http500', ScraperErrorTypes.Generic, 'validate HTTP 500'],
  ['reject', ScraperErrorTypes.Generic, 'validate GENERIC'],
  ['nonJson', ScraperErrorTypes.Generic, 'validate GENERIC'],
  ['timeout', ScraperErrorTypes.Timeout, 'validate TIMEOUT'],
];

/**
 * The carry bundle inside a run's published token.
 * @param run - A finished mocked run.
 * @param issuer - The issuer under test.
 * @returns The decoded key and jar.
 */
function persistedBundle(run: IRingRun, issuer: IRingIssuer): PersistedBundle {
  const token = run.result.persistentOtpToken ?? '';
  const provider = issuer.bank.toLowerCase();
  const decoded = decodeWarmBundle(token, {
    provider,
    accounts: [RING_MOCK_CREDS.id, RING_MOCK_CREDS.card6Digits],
    tagKey: RING_MOCK_CREDS.password,
    slots: ['key', 'bcKey'],
    hasCookies: true,
    maxChars: 16384,
  });
  expect(decoded.success).toBe(true);
  if (!decoded.success) throw new TypeError(decoded.errorMessage);
  return decoded.value;
}

/**
 * The device key inside a run's published carry bundle.
 * @param run - A finished mocked run.
 * @param issuer - The issuer under test.
 * @returns The key the caller would store.
 */
function persistedKey(run: IRingRun, issuer: IRingIssuer): string {
  return persistedBundle(run, issuer).carry.key;
}

/**
 * A warm token carrying a stored key and its session bcKey.
 * @param issuer - The issuer under test.
 * @param key - The device key.
 * @returns An encoded carry bundle with no cookies.
 */
function warmToken(issuer: IRingIssuer, key: string): string {
  const provider = issuer.bank.toLowerCase();
  const encoded = encodeWarmBundle(
    {
      provider,
      accounts: [RING_MOCK_CREDS.id, RING_MOCK_CREDS.card6Digits],
      tagKey: RING_MOCK_CREDS.password,
    },
    { carry: { key, bcKey: ringBcKey(1) }, cookies: [] },
  );
  expect(encoded.success).toBe(true);
  if (!encoded.success) return '';
  return encoded.value;
}

describe.each(ISSUERS)('$bank browserless login', issuer => {
  it('signs in cold, rides the session on every data call', async () => {
    const run = await runRing({ issuer, creds: { ...RING_MOCK_CREDS } });
    expect(run.result.success).toBe(true);
    expect(run.steps).toEqual(COLD_STEPS);
    expect(run.data.length).toBeGreaterThan(0);
    const sent = run.data.map(call => [
      call.headers.get('bckey'),
      call.headers.get('cookie')?.startsWith('RingSession=') ?? false,
    ]);
    const bcKey = ringBcKey(1);
    const required = run.data.map(() => [bcKey, true]);
    expect(sent).toEqual(required);
    const udid = registeredUdid(run.calls);
    expect(udid).toBe(SYN_DEVICE_UDID);
    const persisted = persistedKey(run, issuer);
    expect(persisted).toBe(SYN_ISSUED_KEY);
    const bundle = persistedBundle(run, issuer);
    expect(bundle.cookies).not.toBe(false);
    if (bundle.cookies !== false) {
      const names = bundle.cookies.map(cookie => cookie.name);
      expect(names).toContain('RingSession');
    }
  });

  it('reports each card with its own rows and statement total', async () => {
    const run = await runRing({ issuer, creds: { ...RING_MOCK_CREDS } });
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(account => [
      account.accountNumber,
      account.balance,
      account.txns.map(txn => txn.chargedAmount),
    ]);
    const expected = RING_MOCK_CARDS.map(card => [
      card.last4,
      card.statementTotal,
      card.amounts.map(amount => -amount),
    ]);
    expect(summary).toEqual(expected);
  });

  it('restores the cold session cookies and bcKey on a warm run', async () => {
    const { cold, warm } = await runColdThenWarm(issuer);
    expect(cold.result.success).toBe(true);
    expect(warm.result.success).toBe(true);
    expect(warm.steps).toEqual(WARM_STEPS);
    const isPasswordSent = isSent(warm.calls, RING_MOCK_CREDS.password);
    expect(isPasswordSent).toBe(false);
    const cookie = warm.calls[0]?.headers.get('cookie') ?? '';
    expect(cookie).toContain('RingSession=');
    const coldBcKey = cold.calls
      .find(call => ringStepOf(call) === SESSION_TOKEN)
      ?.headers.get('bckey');
    const warmBcKey = warm.calls[0]?.headers.get('bckey');
    expect(warmBcKey).toBe(coldBcKey);
    const persisted = persistedKey(warm, issuer);
    expect(persisted).toBe(SYN_ISSUED_KEY);
  });

  it('falls back to exactly one cold login when the stored key is stale', async () => {
    const creds = { ...RING_MOCK_CREDS, otpLongTermToken: warmToken(issuer, 'syn-ring-stale-key') };
    const run = await runRing({ issuer, creds });
    expect(run.result.success).toBe(true);
    expect(run.steps).toEqual([RESUME, ...COLD_STEPS]);
    const persisted = persistedKey(run, issuer);
    expect(persisted).toBe(SYN_ISSUED_KEY);
  });

  it('resumes once when the warm session expires before the card list', async () => {
    const creds = { ...RING_MOCK_CREDS, otpLongTermToken: warmToken(issuer, SYN_STORED_KEY) };
    const run = await runRing({ issuer, creds, fault: 'expireOnce' });
    expect(run.result.success).toBe(true);
    expect(run.steps).toEqual([...WARM_STEPS, RESUME, SESSION_TOKEN]);
    expect(run.result.accounts).toHaveLength(RING_MOCK_CARDS.length);
    const persisted = persistedKey(run, issuer);
    expect(persisted).toBe(SYN_STORED_KEY);
    const [expired, ...retried] = run.data.map(call => call.headers.get('bckey'));
    const firstKey = ringBcKey(1);
    const recoveredKeys = retried.map(() => firstKey);
    expect(expired).toBe(firstKey);
    expect(retried).toEqual(recoveredKeys);
  });

  it('fails a run whose card list has a row with no card number, before any month', async () => {
    const run = await runRing({ issuer, creds: { ...RING_MOCK_CREDS }, fault: 'unnamedCard' });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    const dataSteps = run.data.map(ringStepOf);
    expect(dataSteps).toEqual(['CardsList_102Digital']);
  });

  it('fails a cold run whose months the gateway refuses, rather than report them empty', async () => {
    const run = await runRing({ issuer, creds: { ...RING_MOCK_CREDS }, fault: 'refuseMonth' });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toContain('ring call refused');
    expect(run.steps).toEqual(COLD_STEPS);
  });

  it('fails without a cold re-login when the gateway refuses a warm run', async () => {
    const creds = { ...RING_MOCK_CREDS, otpLongTermToken: warmToken(issuer, SYN_STORED_KEY) };
    const run = await runRing({ issuer, creds, fault: 'refuseMonth' });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.steps).toEqual(WARM_STEPS);
  });

  it.each(REFUSALS)('fails $name before any data call', async (refusal: IRefusal) => {
    const run = await runRing({ issuer, creds: refusal.creds, fault: refusal.fault });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(refusal.errorType);
    expect(run.steps).toEqual(refusal.steps);
    expect(run.data).toHaveLength(0);
  });

  it('never sends a malformed stored key and logs in cold instead', async () => {
    const run = await runRing({
      issuer,
      creds: { ...RING_MOCK_CREDS, otpLongTermToken: MALFORMED_TOKEN },
    });
    expect(run.result.success).toBe(true);
    expect(run.steps).toEqual(COLD_STEPS);
    const isTokenSent = isSent(run.calls, 'syn-malformed');
    expect(isTokenSent).toBe(false);
  });

  it.each(STEP_ZERO_FAULTS)(
    'fails a step-0 %s after one call, with no retry and no response text',
    async (fault, errorType, message) => {
      const run = await runRing({ issuer, creds: { ...RING_MOCK_CREDS }, fault });
      expect(run.result.success).toBe(false);
      expect(run.result.errorType).toBe(errorType);
      expect(run.result.errorMessage).toBe(message);
      expect(run.calls).toHaveLength(1);
    },
  );

  it('rejects an empty password before sending any request', async () => {
    const run = await runRing({ issuer, creds: { ...RING_MOCK_CREDS, password: '' } });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('Missing or malformed credentials: password');
    expect(run.calls).toHaveLength(0);
  });
});
