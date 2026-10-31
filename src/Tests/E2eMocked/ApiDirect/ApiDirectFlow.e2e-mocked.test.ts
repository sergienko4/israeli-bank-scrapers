/**
 * Unified API-DIRECT E2E mock — exercises the offline pipeline flow shared
 * by every API-DIRECT bank (Pepper, OneZero, Visa Cal, Isracard, Amex, Max, Mizrahi, ...) through one parameterized
 * spec backed by the per-bank synthetic fetch mocks.
 *
 * Rule #17: mock suite parity stays intact — every bank case in this file
 * preserves the exact assertion coverage of the per-bank file it replaces.
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import type { ScraperCredentials } from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import type { IMockHandle as IKitMockHandle } from '../Helpers/FetchMockKit.js';
import {
  installMaxFetchMock,
  MAX_MOCK_CARDS,
  MAX_MOCK_CREDS,
  MAX_MOCK_START_DATE,
} from '../Max/MaxFetchMock.js';
import { installMizrahiFetchMock } from '../Mizrahi/MizrahiFetchMock.js';
import {
  MIZRAHI_MOCK_ACCOUNTS,
  MIZRAHI_MOCK_CREDS,
  MIZRAHI_MOCK_START_DATE,
} from '../Mizrahi/MizrahiMockData.js';
import type { IMockHandle as IOneZeroMockHandle } from '../OneZero/OneZeroFetchMock.js';
import {
  installOneZeroFetchMock,
  ONEZERO_MOCK_CREDS,
  SYN_ID_TOKEN,
} from '../OneZero/OneZeroFetchMock.js';
import type { IMockHandle as IPepperMockHandle } from '../Pepper/PepperFetchMock.js';
import { installPepperFetchMock, PEPPER_MOCK_CREDS } from '../Pepper/PepperFetchMock.js';
import {
  AMEX_RING_TARGET,
  installRingFetchMock,
  ISRACARD_RING_TARGET,
  RING_MOCK_CARDS,
  RING_MOCK_CREDS,
  RING_MOCK_START_DATE,
  SYN_ISSUED_KEY,
  SYN_STORED_KEY,
} from '../Ring/RingFetchMock.js';
import {
  installVisaCalFetchMock,
  rotatedHash,
  SYN_LOGIN_HASH,
  SYN_STORED_HASH,
  VISACAL_MOCK_CARDS,
  VISACAL_MOCK_CREDS,
  VISACAL_MOCK_START_DATE,
} from '../VisaCal/VisaCalFetchMock.js';

/**
 * Fixed window opening before the Pepper fixture's synthetic rows
 * (`2026-03-10` / `2026-03-15` in `PepperFetchMock.ts`).
 *
 * Was `Date.now() - 90 days`. A relative window against static fixture rows
 * silently ages out: once the phase began honouring `startDate`
 * ({@link applyStartWindow}), the rows fell outside it and the scrape returned
 * zero transactions. Fixed dates on both sides keep the case deterministic —
 * the same reason its OneZero sibling below already uses one.
 */
const PEPPER_START_DATE = new Date('2026-01-01');

/** Fixed window matching the original OneZero spec. */
const ONEZERO_START_DATE = new Date('2026-01-01');

/** Synthetic OTP code returned by the Pepper fake retriever. */
const PEPPER_FAKE_OTP = 'fixt-otp-pep-7c1a';

/** Shared mock-handle shape — every per-bank mock exposes this contract. */
type MockHandle = IPepperMockHandle | IOneZeroMockHandle | IKitMockHandle;

/** Minimal account shape consumed by the parameterized assertions. */
interface IAccountSlice {
  readonly accountNumber: string;
  readonly balance?: number;
  readonly txns: readonly unknown[];
}

/**
 * One parameterized flow case — maps a bank onto the inputs and thresholds
 * that drive the shared API-DIRECT scrape assertions.
 */
interface IApiDirectFlowCase {
  readonly displayName: string;
  readonly companyId: CompanyTypes;
  readonly installFetchMock: () => MockHandle;
  readonly mockCreds: ScraperCredentials;
  readonly otpCodeRetriever?: (phoneHint: string) => Promise<string>;
  readonly startDate: Date;
  readonly expectedAccounts: number;
  readonly expectedAccountNumber?: string;
  readonly expectedBalance?: number;
  readonly minTxns?: number;
  readonly minGraphqlCalls: number;
  readonly minIdentityCalls?: number;
  readonly maxIdentityCalls?: number;
  readonly expectsWarmStart?: boolean;
  /** Exact `result.persistentOtpToken` the caller must receive back. */
  readonly expectedPersistentToken?: string;
  /** How many times the pipeline is allowed to ask for an SMS code. */
  readonly expectedOtpPrompts?: number;
  readonly timeoutMs?: number;
}

/**
 * Fake OTP retriever — mock mode never sends a real SMS.
 * @returns Placeholder code consumed by the Pepper login pipeline.
 */
function fakeOtpRetriever(): Promise<string> {
  return Promise.resolve(PEPPER_FAKE_OTP);
}

const PEPPER_CASE: IApiDirectFlowCase = {
  displayName: 'Pepper',
  companyId: CompanyTypes.Pepper,
  installFetchMock: installPepperFetchMock,
  mockCreds: { ...PEPPER_MOCK_CREDS },
  otpCodeRetriever: fakeOtpRetriever,
  startDate: PEPPER_START_DATE,
  expectedAccounts: 1,
  // FINDING-9 (8b RabbitAI review) — restore txn-shape assertion the
  // unified spec dropped relative to the original Pepper E2eMocked test.
  // PepperFetchMock returns 1 posted + 1 pending row per page, so the
  // canonical scrape result must surface at least one txn per account.
  minTxns: 1,
  minGraphqlCalls: 3,
};

/** Records whether the pipeline asked for an SMS code during a run. */
const OTP_PROMPTS: string[] = [];

/** OTP code the OneZero mock accepts on the cold chain. */
const ONEZERO_FAKE_OTP = '123456';

/**
 * OTP retriever that records being called.
 * A warm start must never reach it: needing a code means we fell back to the
 * cold SMS chain, which is the silent degradation issue #576 reported.
 * @param phoneHint - Masked phone the pipeline would have texted.
 * @returns Placeholder code, only ever used if the cold path is taken.
 */
function recordingOtpRetriever(phoneHint: string): Promise<string> {
  OTP_PROMPTS.push(phoneHint);
  return Promise.resolve(ONEZERO_FAKE_OTP);
}

/**
 * Zero-arg OTP retriever matching the credentials-side contract.
 * @returns Placeholder code, recorded so the test can count SMS prompts.
 */
function credsOtpRetriever(): Promise<string> {
  return recordingOtpRetriever('creds');
}

const ONEZERO_CASE: IApiDirectFlowCase = {
  displayName: 'OneZero',
  companyId: CompanyTypes.OneZero,
  installFetchMock: installOneZeroFetchMock,
  mockCreds: { ...ONEZERO_MOCK_CREDS },
  otpCodeRetriever: recordingOtpRetriever,
  startDate: ONEZERO_START_DATE,
  expectedAccounts: 1,
  expectedAccountNumber: '40286139',
  expectedBalance: 2850.6,
  minTxns: 2,
  minGraphqlCalls: 3,
  // One call: /sessions/token. A warm start that also hits /getIdToken is
  // replaying a mid-chain artifact and has regressed to the issue-#576 shape.
  minIdentityCalls: 1,
  maxIdentityCalls: 1,
  expectsWarmStart: true,
  // The stored seed is replayed verbatim, so the caller gets it back unchanged.
  expectedPersistentToken: ONEZERO_MOCK_CREDS.otpLongTermToken,
  expectedOtpPrompts: 0,
  timeoutMs: 60000,
};

/**
 * Credentials without a stored long-term token — forces the full cold chain.
 * @returns OneZero mock credentials minus `otpLongTermToken`.
 */
function coldOneZeroCreds(): ScraperCredentials {
  const { otpLongTermToken, ...rest } = ONEZERO_MOCK_CREDS;
  expect(otpLongTermToken.length).toBeGreaterThan(0);
  return { ...rest, otpCodeRetriever: credsOtpRetriever };
}

const ONEZERO_COLD_CASE: IApiDirectFlowCase = {
  ...ONEZERO_CASE,
  displayName: 'OneZero (cold)',
  mockCreds: coldOneZeroCreds(),
  // Full chain: devices/token, otp/prepare, otp/verify, getIdToken, sessions/token.
  minIdentityCalls: 5,
  maxIdentityCalls: 5,
  expectsWarmStart: false,
  // A cold run mints a brand-new handle; the caller must receive that one so it
  // can be stored for the next run. Distinct from the stored seed by `sub`.
  expectedPersistentToken: SYN_ID_TOKEN,
  expectedOtpPrompts: 1,
};

const VISACAL_COLD_CASE: IApiDirectFlowCase = {
  displayName: 'Visa Cal (cold)',
  companyId: CompanyTypes.VisaCal,
  installFetchMock: installVisaCalFetchMock,
  mockCreds: { ...VISACAL_MOCK_CREDS },
  startDate: VISACAL_MOCK_START_DATE,
  expectedAccounts: VISACAL_MOCK_CARDS.length,
  expectedAccountNumber: VISACAL_MOCK_CARDS[0].last4Digits,
  expectedBalance: VISACAL_MOCK_CARDS[0].nextTotalDebit,
  minTxns: 2,
  // account/init, then a frames call and at least one month per card.
  minGraphqlCalls: 1 + 2 * VISACAL_MOCK_CARDS.length,
  // regularLogin, then bioLogin. No OTP step exists.
  minIdentityCalls: 2,
  maxIdentityCalls: 2,
  expectsWarmStart: false,
  // bioLogin rotates the hash regularLogin issued; the caller stores that one.
  expectedPersistentToken: rotatedHash(SYN_LOGIN_HASH),
};

const VISACAL_WARM_CASE: IApiDirectFlowCase = {
  ...VISACAL_COLD_CASE,
  displayName: 'Visa Cal (warm)',
  mockCreds: { ...VISACAL_MOCK_CREDS, otpLongTermToken: SYN_STORED_HASH },
  // bioLogin alone: the stored hash replaces the password step.
  minIdentityCalls: 1,
  maxIdentityCalls: 1,
  expectsWarmStart: true,
  expectedPersistentToken: rotatedHash(SYN_STORED_HASH),
};

const ISRACARD_COLD_CASE: IApiDirectFlowCase = {
  displayName: 'Isracard (cold)',
  companyId: CompanyTypes.Isracard,
  /**
   * Install the synthetic ring as Isracard.
   * @returns Mock handle.
   */
  installFetchMock: (): IKitMockHandle => installRingFetchMock(ISRACARD_RING_TARGET),
  mockCreds: { ...RING_MOCK_CREDS },
  startDate: RING_MOCK_START_DATE,
  expectedAccounts: RING_MOCK_CARDS.length,
  expectedAccountNumber: RING_MOCK_CARDS[0].last4,
  expectedBalance: RING_MOCK_CARDS[0].statementTotal,
  minTxns: 2,
  // The card list, then the debit month and at least one window month per card.
  minGraphqlCalls: 1 + 2 * RING_MOCK_CARDS.length,
  // Validate, logon, device key, register, key sign-in, session. No OTP step exists.
  minIdentityCalls: 6,
  maxIdentityCalls: 6,
  expectsWarmStart: false,
  // The device key the ring issued and registered; the caller stores it.
  expectedPersistentToken: SYN_ISSUED_KEY,
};

const ISRACARD_WARM_CASE: IApiDirectFlowCase = {
  ...ISRACARD_COLD_CASE,
  displayName: 'Isracard (warm)',
  mockCreds: { ...RING_MOCK_CREDS, otpLongTermToken: SYN_STORED_KEY },
  // Key sign-in and session alone: the stored key replaces the password steps.
  minIdentityCalls: 2,
  maxIdentityCalls: 2,
  expectsWarmStart: true,
  // The key does not rotate, so the caller gets the stored one back.
  expectedPersistentToken: SYN_STORED_KEY,
};

const AMEX_COLD_CASE: IApiDirectFlowCase = {
  ...ISRACARD_COLD_CASE,
  displayName: 'Amex (cold)',
  companyId: CompanyTypes.Amex,
  /**
   * Install the synthetic ring as Amex.
   * @returns Mock handle.
   */
  installFetchMock: (): IKitMockHandle => installRingFetchMock(AMEX_RING_TARGET),
};

const AMEX_WARM_CASE: IApiDirectFlowCase = {
  ...ISRACARD_WARM_CASE,
  displayName: 'Amex (warm)',
  companyId: CompanyTypes.Amex,
  installFetchMock: AMEX_COLD_CASE.installFetchMock,
};

const MAX_COLD_CASE: IApiDirectFlowCase = {
  displayName: 'Max (cold)',
  companyId: CompanyTypes.Max,
  /**
   * Install the synthetic max.co.il.
   * @returns Mock handle.
   */
  installFetchMock: (): IKitMockHandle => installMaxFetchMock(),
  mockCreds: { ...MAX_MOCK_CREDS },
  startDate: MAX_MOCK_START_DATE,
  expectedAccounts: MAX_MOCK_CARDS.length,
  expectedAccountNumber: MAX_MOCK_CARDS[0].last4,
  expectedBalance: MAX_MOCK_CARDS[0].cycleDebit,
  minTxns: 2,
  // The card list, then at least one month per card.
  minGraphqlCalls: 1 + MAX_MOCK_CARDS.length,
  // Client context, then login. No OTP step and no stored token exist.
  minIdentityCalls: 2,
  maxIdentityCalls: 2,
  expectsWarmStart: false,
};

const MIZRAHI_COLD_CASE: IApiDirectFlowCase = {
  displayName: 'Mizrahi (cold)',
  companyId: CompanyTypes.Mizrahi,
  /**
   * Install the synthetic www + mto hosts.
   * @returns Mock handle.
   */
  installFetchMock: (): IKitMockHandle => installMizrahiFetchMock(),
  mockCreds: { ...MIZRAHI_MOCK_CREDS },
  startDate: MIZRAHI_MOCK_START_DATE,
  expectedAccounts: MIZRAHI_MOCK_ACCOUNTS.length,
  expectedAccountNumber: MIZRAHI_MOCK_ACCOUNTS[0].number,
  expectedBalance: MIZRAHI_MOCK_ACCOUNTS[0].balance,
  minTxns: MIZRAHI_MOCK_ACCOUNTS[0].amounts.length,
  // Per account: the switch, then at least one movements page.
  minGraphqlCalls: 2 * MIZRAHI_MOCK_ACCOUNTS.length,
  // Bootstrap and login, three landing hops, then logon. No OTP, no token.
  minIdentityCalls: 6,
  maxIdentityCalls: 6,
  expectsWarmStart: false,
};

const CASES: readonly IApiDirectFlowCase[] = [
  PEPPER_CASE,
  ONEZERO_CASE,
  ONEZERO_COLD_CASE,
  VISACAL_COLD_CASE,
  VISACAL_WARM_CASE,
  ISRACARD_COLD_CASE,
  ISRACARD_WARM_CASE,
  AMEX_COLD_CASE,
  AMEX_WARM_CASE,
  MAX_COLD_CASE,
  MIZRAHI_COLD_CASE,
];

/** Minimal scraper-options shape exercised by this parameterized spec. */
interface IApiDirectScraperOptions {
  readonly companyId: CompanyTypes;
  readonly startDate: Date;
  readonly otpCodeRetriever?: (phoneHint: string) => Promise<string>;
}

/**
 * Builds the scraper-options shape, omitting the OTP retriever when the
 * bank's flow does not require one. Kept tiny so the test body stays flat.
 * @param testCase parameterized bank case being executed.
 * @returns Options literal accepted by {@link createScraper}.
 */
function buildScraperOptions(testCase: IApiDirectFlowCase): IApiDirectScraperOptions {
  const base: IApiDirectScraperOptions = {
    companyId: testCase.companyId,
    startDate: testCase.startDate,
  };
  return testCase.otpCodeRetriever
    ? { ...base, otpCodeRetriever: testCase.otpCodeRetriever }
    : base;
}

/**
 * Asserts the per-bank account-shape thresholds carried by the case.
 * Skipping a threshold is encoded as `undefined` on the case object.
 * @param account first scraped account under assertion.
 * @param testCase parameterized bank case providing the thresholds.
 * @returns `true` once every encoded threshold has been verified.
 */
function assertAccountShape(account: IAccountSlice, testCase: IApiDirectFlowCase): boolean {
  if (testCase.expectedAccountNumber !== undefined) {
    expect(account.accountNumber).toBe(testCase.expectedAccountNumber);
  }
  if (testCase.expectedBalance !== undefined) {
    expect(account.balance).toBe(testCase.expectedBalance);
  }
  if (testCase.minTxns !== undefined) {
    expect(account.txns.length).toBeGreaterThanOrEqual(testCase.minTxns);
  }
  return true;
}

/**
 * Asserts the per-bank API-call lower bounds captured by the fetch mock.
 * @param handle mock handle exposing the call counters.
 * @param testCase parameterized bank case providing the minimums.
 * @returns `true` once every counter threshold has been verified.
 */
function assertCallCounts(handle: MockHandle, testCase: IApiDirectFlowCase): boolean {
  const counts = handle.callCounts();
  expect(counts.graphql).toBeGreaterThanOrEqual(testCase.minGraphqlCalls);
  if (testCase.maxIdentityCalls !== undefined) {
    expect(counts.identity).toBeLessThanOrEqual(testCase.maxIdentityCalls);
  }
  if (testCase.minIdentityCalls !== undefined) {
    expect(counts.identity).toBeGreaterThanOrEqual(testCase.minIdentityCalls);
  }
  return true;
}

/** Slice of the scrape result carrying the durable re-login token. */
interface IAuthOutcomeSlice {
  readonly persistentOtpToken?: string;
}

/**
 * Asserts the caller-visible auth outcome: how many SMS prompts the run cost
 * and which durable token the caller receives back to store for next time.
 * @param result scrape result under assertion.
 * @param testCase parameterized bank case providing the expectations.
 * @returns `true` once every encoded expectation has been verified.
 */
function assertAuthOutcome(result: IAuthOutcomeSlice, testCase: IApiDirectFlowCase): boolean {
  if (testCase.expectedOtpPrompts !== undefined) {
    expect(OTP_PROMPTS).toHaveLength(testCase.expectedOtpPrompts);
  }
  if (testCase.expectedPersistentToken !== undefined) {
    expect(result.persistentOtpToken).toBe(testCase.expectedPersistentToken);
  }
  return true;
}

describe.each(CASES)('API-DIRECT mocked E2E — $displayName', testCase => {
  beforeEach(() => {
    OTP_PROMPTS.length = 0;
  });

  it(
    'completes login + scrape and returns synthetic accounts',
    async () => {
      const handle = testCase.installFetchMock();
      try {
        const scraperOptions = buildScraperOptions(testCase);
        const scraper = createScraper(scraperOptions);
        const result = await scraper.scrape({ ...testCase.mockCreds });
        expect(result.success).toBe(true);
        if (result.success) {
          const accounts = (result.accounts ?? []) as IAccountSlice[];
          expect(accounts).toHaveLength(testCase.expectedAccounts);
          assertAccountShape(accounts[0], testCase);
          assertCallCounts(handle, testCase);
          assertAuthOutcome(result, testCase);
        }
      } finally {
        handle.dispose();
      }
    },
    testCase.timeoutMs,
  );
});

/** Any URL the mock classifies as the session-token identity route. */
const SESSION_TOKEN_URL = 'https://identity.example.test/sessions/token';

/**
 * POST a body through the installed mock fetch, as the pipeline does.
 * @param body - Request body object.
 * @returns HTTP status the mock answered with.
 */
async function postSessionToken(body: Readonly<Record<string, string>>): Promise<number> {
  const response = await fetch(SESSION_TOKEN_URL, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.status;
}

describe('OneZero mock — the mandatory password is part of the contract', () => {
  let handle: IOneZeroMockHandle;

  beforeEach(() => {
    handle = installOneZeroFetchMock();
  });

  afterEach(() => {
    handle.dispose();
  });

  it('mints an access token when idToken and pass are both present', async () => {
    const status = await postSessionToken({
      idToken: SYN_ID_TOKEN,
      pass: ONEZERO_MOCK_CREDS.password,
    });
    expect(status).toBe(200);
  });

  it('refuses a session-token request that omits the password', async () => {
    const status = await postSessionToken({ idToken: SYN_ID_TOKEN });
    expect(status).not.toBe(200);
  });

  it('refuses a session-token request carrying the wrong password', async () => {
    const status = await postSessionToken({ idToken: SYN_ID_TOKEN, pass: 'not-the-password' });
    expect(status).not.toBe(200);
  });
});
