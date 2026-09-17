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
import type { IAuthFlowInfo, ScraperCredentials } from '../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import type { IMockHandle as IOneZeroMockHandle } from '../OneZero/OneZeroFetchMock.js';
import {
  installOneZeroFetchMock,
  ONEZERO_MOCK_ACCESS_TOKEN,
  ONEZERO_MOCK_CREDS,
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

/** Captured onAuthFlowComplete payload — false until the callback fires. */
type AuthCapture = IAuthFlowInfo | false;

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
  readonly expectedIdentityCalls?: number;
  readonly assertAuthFlow?: (handle: MockHandle, auth: AuthCapture) => true;
  readonly timeoutMs?: number;
}

/**
 * Fake OTP retriever — mock mode never sends a real SMS.
 * @returns Placeholder code consumed by the Pepper login pipeline.
 */
function fakeOtpRetriever(): Promise<string> {
  return Promise.resolve(PEPPER_FAKE_OTP);
}

/** Mutable slot receiving the onAuthFlowComplete payload. */
interface IAuthCaptureSlot {
  current: AuthCapture;
}

/**
 * Build an onAuthFlowComplete callback storing each payload into the slot.
 * The inner arrow stays annotation-free: the outer return type supplies the
 * contextual type, and an explicit `: void` trips the repo's void-return ban.
 * @param slot - Mutable capture slot.
 * @returns Callback compatible with ScraperOptions.onAuthFlowComplete.
 */
function makeAuthCapture(slot: IAuthCaptureSlot): (info: IAuthFlowInfo) => void | Promise<void> {
  return (info: IAuthFlowInfo) => {
    slot.current = info;
  };
}

/**
 * Assert the OneZero warm-start side effects: exactly one identity request
 * (sessions/token) whose body carries the seeded idToken + password, and an
 * auth-flow payload that round-trips the same idToken.
 * @param handle - Installed OneZero mock handle.
 * @param auth - Captured onAuthFlowComplete payload (false when never fired).
 * @returns true once every assertion has run.
 */
function assertOneZeroWarmStart(handle: IOneZeroMockHandle, auth: AuthCapture): true {
  const requests = handle.identityRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toContain('/v1/sessions/token');
  expect(requests[0].body).toEqual({
    idToken: ONEZERO_MOCK_CREDS.otpLongTermToken,
    pass: ONEZERO_MOCK_CREDS.password,
  });
  if (auth === false) throw new ScraperError('onAuthFlowComplete should have fired');
  expect(auth.longTermToken).toBe(ONEZERO_MOCK_CREDS.otpLongTermToken);
  expect(auth.bearer).toBe(`Bearer ${ONEZERO_MOCK_ACCESS_TOKEN}`);
  return true;
}

/**
 * OneZero case hook — narrows the shared handle to the OneZero mock and
 * delegates to {@link assertOneZeroWarmStart}.
 * @param handle - Installed mock handle (OneZero for this case).
 * @param auth - Captured onAuthFlowComplete payload.
 * @returns true once the OneZero assertions have run.
 */
function assertOneZeroAuthFlow(handle: MockHandle, auth: AuthCapture): true {
  return assertOneZeroWarmStart(handle as IOneZeroMockHandle, auth);
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

const ONEZERO_CASE: IApiDirectFlowCase = {
  displayName: 'OneZero',
  companyId: CompanyTypes.OneZero,
  installFetchMock: installOneZeroFetchMock,
  mockCreds: { ...ONEZERO_MOCK_CREDS },
  startDate: ONEZERO_START_DATE,
  expectedAccounts: 1,
  expectedAccountNumber: '40286139',
  expectedBalance: 2850.6,
  minTxns: 2,
  minGraphqlCalls: 3,
  // Warm start seeds the ~10-year idToken and runs ONLY sessions/token —
  // exactly one identity call. Was minIdentityCalls: 2 while the warm path
  // still re-ran getIdToken on the 1-hour otpToken (which always 500'd live).
  expectedIdentityCalls: 1,
  assertAuthFlow: assertOneZeroAuthFlow,
  timeoutMs: 60000,
};

const CASES: readonly IApiDirectFlowCase[] = [PEPPER_CASE, ONEZERO_CASE];

/** Minimal scraper-options shape exercised by this parameterized spec. */
interface IApiDirectScraperOptions {
  readonly companyId: CompanyTypes;
  readonly startDate: Date;
  readonly otpCodeRetriever?: (phoneHint: string) => Promise<string>;
  readonly onAuthFlowComplete?: (info: IAuthFlowInfo) => void | Promise<void>;
}

/**
 * Builds the scraper-options shape, omitting the OTP retriever when the
 * bank's flow does not require one. Kept tiny so the test body stays flat.
 * @param testCase parameterized bank case being executed.
 * @param slot mutable slot receiving the onAuthFlowComplete payload.
 * @returns Options literal accepted by {@link createScraper}.
 */
function buildScraperOptions(
  testCase: IApiDirectFlowCase,
  slot: IAuthCaptureSlot,
): IApiDirectScraperOptions {
  const base: IApiDirectScraperOptions = {
    companyId: testCase.companyId,
    startDate: testCase.startDate,
    onAuthFlowComplete: makeAuthCapture(slot),
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
 * Asserts the per-bank API-call bounds captured by the fetch mock.
 * Identity calls are exact (warm-start pins a single sessions/token);
 * GraphQL stays a lower bound because pagination depth may grow.
 * @param handle mock handle exposing the call counters.
 * @param testCase parameterized bank case providing the expectations.
 * @returns `true` once every counter expectation has been verified.
 */
function assertCallCounts(handle: MockHandle, testCase: IApiDirectFlowCase): boolean {
  const counts = handle.callCounts();
  expect(counts.graphql).toBeGreaterThanOrEqual(testCase.minGraphqlCalls);
  if (testCase.expectedIdentityCalls !== undefined) {
    expect(counts.identity).toBe(testCase.expectedIdentityCalls);
  }
  return true;
}

/**
 * Invokes the case's optional auth-flow assertions with the captured payload.
 * @param testCase parameterized bank case providing the optional assertion hook.
 * @param handle mock handle installed for this run.
 * @param auth captured onAuthFlowComplete payload (false when never fired).
 * @returns `true` once the hook (or its absence) has been honoured.
 */
function assertAuthFlow(testCase: IApiDirectFlowCase, handle: MockHandle, auth: AuthCapture): true {
  if (testCase.assertAuthFlow === undefined) return true;
  return testCase.assertAuthFlow(handle, auth);
}

describe.each(CASES)('API-DIRECT mocked E2E — $displayName', testCase => {
  it(
    'completes login + scrape and returns synthetic accounts',
    async () => {
      const handle = testCase.installFetchMock();
      const authSlot: IAuthCaptureSlot = { current: false };
      try {
        const scraperOptions = buildScraperOptions(testCase, authSlot);
        const scraper = createScraper(scraperOptions);
        const result = await scraper.scrape({ ...testCase.mockCreds });
        expect(result.success).toBe(true);
        if (result.success) {
          const accounts = (result.accounts ?? []) as IAccountSlice[];
          expect(accounts).toHaveLength(testCase.expectedAccounts);
          assertAccountShape(accounts[0], testCase);
          assertCallCounts(handle, testCase);
          assertAuthFlow(testCase, handle, authSlot.current);
        }
      } finally {
        handle.dispose();
      }
    },
    testCase.timeoutMs,
  );
});
