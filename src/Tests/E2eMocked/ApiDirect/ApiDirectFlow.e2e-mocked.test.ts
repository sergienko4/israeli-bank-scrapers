/**
 * Unified API-DIRECT E2E mock — exercises the offline pipeline flow shared
 * by every API-DIRECT bank (Pepper, OneZero, ...) through one parameterized
 * spec backed by the per-bank synthetic fetch mocks.
 *
 * Rule #17: mock suite parity stays intact — every bank case in this file
 * preserves the exact assertion coverage of the per-bank file it replaces.
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import type { ScraperCredentials } from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import type { IMockHandle as IOneZeroMockHandle } from '../OneZero/OneZeroFetchMock.js';
import {
  installOneZeroFetchMock,
  ONEZERO_MOCK_CREDS,
  SYN_ID_TOKEN,
} from '../OneZero/OneZeroFetchMock.js';
import type { IMockHandle as IPepperMockHandle } from '../Pepper/PepperFetchMock.js';
import { installPepperFetchMock, PEPPER_MOCK_CREDS } from '../Pepper/PepperFetchMock.js';

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

/** Shared mock-handle shape — both per-bank mocks expose this contract. */
type MockHandle = IPepperMockHandle | IOneZeroMockHandle;

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

const CASES: readonly IApiDirectFlowCase[] = [PEPPER_CASE, ONEZERO_CASE, ONEZERO_COLD_CASE];

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
