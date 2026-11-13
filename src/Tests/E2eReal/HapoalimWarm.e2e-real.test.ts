/**
 * Opt-in real-E2E proof of Hapoalim's cookie-jar warm start.
 *
 * <p>Separate from `Hapoalim.e2e-real.test.ts` because the two runs cost a
 * different number of SMS messages and must never share a budget:
 *
 * <ul>
 *   <li>`HAPOALIM_OTP_LONG_TERM=1 HAPOALIM_WARM_ENROLL=1` — enroll: one cold
 *       login, at most one SMS, and the session is cached.</li>
 *   <li>`HAPOALIM_OTP_LONG_TERM=1` — resume: the cached session must skip the
 *       login steps, so the run must spend zero SMS messages.</li>
 * </ul>
 *
 * <p>A resume without a cached token fails before any request. A resume that
 * does ask for a code fails loudly instead of buying one: the retriever throws
 * and the fetch witness proves no login endpoint was called.
 */

import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes } from '../../index.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { getDebug } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { type IFetchPathWitness, installFetchPathWitness } from './FetchPathWitness.js';
import {
  createHapoalimWarmCache,
  type HapoalimWarmRunKind,
  hapoalimWarmRunKindOf,
  type IHapoalimWarmPlan,
  planHapoalimWarmRun,
  resolveOtpTimeoutMs,
  RESUME_ALLOWANCE,
} from './HapoalimWarmHarness.js';
import { assertSuccessfulScrape, logScrapedTransactions, SCRAPE_TIMEOUT } from './Helpers.js';
import { createLoginWitness, type ILoginWitness } from './LoginWitness.js';
import { createOtpBudget, type IOtpBudget, type OtpRetriever } from './OtpBudget.js';
import { createBankOtpPoller } from './OtpPoller.js';
import { createScrapeAttempt } from './ScrapeAttempt.js';
import type { ITokenCacheHandle } from './TokenCache.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCredentials = !!(process.env.HAPOALIM_USER_CODE && process.env.HAPOALIM_PASSWORD);

/** Warm run the flags select; `off` skips this suite. */
const WARM_KIND: HapoalimWarmRunKind = hapoalimWarmRunKindOf(process.env);

/** Wait budget applied to both the poller and the pipeline's OTP guard. */
const OTP_TIMEOUT_MS = resolveOtpTimeoutMs(process.env);

/**
 * Only a flagged warm run with credentials executes; the cold suite skips the
 * same combinations, so one invocation runs exactly one scenario.
 */
const DESCRIBE_IF = hasCredentials && WARM_KIND !== 'off' ? describe : describe.skip;

/** Endpoints a warm resume must never call: every step before the landing. */
const LOGIN_PATH_MARKERS = ['/authenticate/', '/ng-portals/auth/serial-number'] as const;

/** The landing call a warm resume starts at. */
const LANDING_PATH = '/ServerServices/landing-page';

/** Everything one warm run produced, for the assertions. */
interface IWarmRun {
  readonly result: IScraperScrapingResult;
  readonly otpSpent: number;
  readonly tokenBefore: string;
  readonly tokenAfter: string;
  readonly witnessed: string;
  readonly loginPaths: readonly string[];
  readonly landingCalled: boolean;
}

/** Inputs a warm run carries into its evidence collection. */
interface IWarmCollectArgs {
  readonly kind: Exclude<HapoalimWarmRunKind, 'off'>;
  readonly cache: ITokenCacheHandle;
  readonly tokenBefore: string;
  readonly plan: IHapoalimWarmPlan;
  readonly witness: IFetchPathWitness;
  readonly checkpoint: number;
  readonly otpTimeoutMs: number;
}

/** Inputs shared by the evidence collector and the single scrape attempt. */
interface IWarmAttemptArgs extends IWarmCollectArgs {
  readonly otpBudget: IOtpBudget;
  readonly loginWitness: ILoginWitness;
}

/** Scrape result plus the cache and wire traffic one run observed. */
interface IWarmRunBundle {
  /** Inputs the run started with. */
  readonly args: IWarmCollectArgs;
  /** The scrape result. */
  readonly result: IScraperScrapingResult;
  /** Messages the run spent. */
  readonly otpBudget: IOtpBudget;
  /** What the login callback reported. */
  readonly loginWitness: ILoginWitness;
  /** URL pathnames captured during the run. */
  readonly paths: readonly string[];
  /** Token the cache holds after the run. */
  readonly tokenAfter: string;
}

/** Hapoalim credentials plus the OTP budget the flow reads. */
interface IWarmCreds {
  /** User code from the environment. */
  readonly userCode: string;
  /** Password from the environment. */
  readonly password: string;
  /** Cached session token, or '' for enrollment. */
  readonly otpLongTermToken: string;
  /** Metered retriever the flow may call. */
  readonly otpCodeRetriever: OtpRetriever;
  /** Budget the flow grants the retriever. */
  readonly otpTimeoutMs: number;
}

/**
 * Whether a request path belongs to the login flow.
 * @param path - Captured URL pathname.
 * @returns True for a login step.
 */
function isLoginPath(path: string): boolean {
  return LOGIN_PATH_MARKERS.some(marker => path.includes(marker));
}

/**
 * Filter the captured paths down to login steps.
 * @param paths - Captured URL pathnames.
 * @returns The login paths, if any.
 */
function loginPathsIn(paths: readonly string[]): readonly string[] {
  return paths.filter(isLoginPath);
}

/**
 * Refuse an OTP request. Reaching this retriever means the resume went cold.
 * @returns Never.
 * @throws ScraperError always, naming the forbidden cold login.
 */
function refuseOtp(): Promise<string> {
  throw new ScraperError('warm resume must not request an SMS code');
}

/**
 * Build Hapoalim credentials for one warm attempt.
 * @param token - Cached token, or '' for enrollment.
 * @param otpCodeRetriever - Metered retriever the attempt may use.
 * @param otpTimeoutMs - Budget the flow grants the retriever.
 * @returns Credential shape the pipeline accepts.
 */
function warmCredsOf(
  token: string,
  otpCodeRetriever: OtpRetriever,
  otpTimeoutMs: number,
): IWarmCreds {
  return {
    userCode: process.env.HAPOALIM_USER_CODE ?? '',
    password: process.env.HAPOALIM_PASSWORD ?? '',
    otpLongTermToken: token,
    otpCodeRetriever,
    otpTimeoutMs,
  };
}

/**
 * Run the one scrape a warm scenario is allowed.
 * @param args - Plan, caches and metered retriever.
 * @returns Scrape result.
 */
function attemptWarmScrape(args: IWarmAttemptArgs): Promise<IScraperScrapingResult> {
  const runScrape = createScrapeAttempt({
    companyId: CompanyTypes.Hapoalim,
    onAuthFlowComplete: args.loginWitness.writer,
  });
  const poller =
    args.kind === 'enroll' ? createBankOtpPoller('Hapoalim', LOG, args.otpTimeoutMs) : refuseOtp;
  const otpCodeRetriever = args.otpBudget.meter(poller);
  const creds = warmCredsOf(args.plan.token, otpCodeRetriever, args.otpTimeoutMs);
  return runScrape(creds);
}

/**
 * Scrape once, then record what the cache and the wire actually saw.
 * @param args - Plan, caches and fetch witness.
 * @returns Run evidence.
 */
async function collectWarmRun(args: IWarmCollectArgs): Promise<IWarmRun> {
  const otpBudget = createOtpBudget();
  const loginWitness = createLoginWitness(args.cache.writer);
  const result = await attemptWarmScrape({ ...args, otpBudget, loginWitness });
  const paths = args.witness.pathsSince(args.checkpoint);
  const tokenAfter = await args.cache.read();
  return warmRunOf({ args, result, otpBudget, loginWitness, paths, tokenAfter });
}

/**
 * Assemble one warm run's evidence.
 * @param bundle - Scrape result plus observed cache and wire traffic.
 * @returns Run evidence.
 */
function warmRunOf(bundle: IWarmRunBundle): IWarmRun {
  return {
    result: bundle.result,
    otpSpent: bundle.otpBudget.spent(),
    tokenBefore: bundle.args.tokenBefore,
    tokenAfter: bundle.tokenAfter,
    witnessed: bundle.loginWitness.lastToken(),
    loginPaths: loginPathsIn(bundle.paths),
    landingCalled: bundle.paths.some(path => path === LANDING_PATH),
  };
}

/**
 * Run the selected warm scenario, always restoring the global fetch.
 * @param kind - Warm run kind (not `off`).
 * @returns Run evidence.
 */
async function runWarmScrape(kind: Exclude<HapoalimWarmRunKind, 'off'>): Promise<IWarmRun> {
  const cache = createHapoalimWarmCache(LOG);
  const tokenBefore = await cache.read();
  const plan = await planHapoalimWarmRun(kind, cache);
  const witness = installFetchPathWitness();
  const checkpoint = witness.checkpoint();
  try {
    return await collectWarmRun({
      kind,
      cache,
      tokenBefore,
      plan,
      witness,
      checkpoint,
      otpTimeoutMs: OTP_TIMEOUT_MS,
    });
  } finally {
    witness.dispose();
  }
}

/**
 * Assert an enrollment completed, spent at most one SMS and cached the token.
 * @param run - Warm run evidence.
 * @returns True once asserted.
 */
function assertEnrollment(run: IWarmRun): boolean {
  assertSuccessfulScrape(run.result);
  expect(run.otpSpent).toBeLessThanOrEqual(1);
  expect(run.loginPaths.length).toBeGreaterThan(0);
  expect(run.tokenAfter.length).toBeGreaterThan(0);
  expect(run.tokenAfter).toBe(run.witnessed);
  expect(run.result.persistentOtpToken).toBe(run.tokenAfter);
  return true;
}

/**
 * Assert a resume skipped every login step and spent no SMS.
 * @param run - Warm run evidence.
 * @returns True once asserted.
 */
function assertResume(run: IWarmRun): boolean {
  assertSuccessfulScrape(run.result);
  expect(run.otpSpent).toBe(RESUME_ALLOWANCE.maxOtp);
  expect(run.loginPaths).toEqual([]);
  expect(run.landingCalled).toBe(true);
  expect(run.tokenBefore.length).toBeGreaterThan(0);
  expect(run.witnessed.length).toBeGreaterThan(0);
  expect(run.result.persistentOtpToken).toBe(run.tokenAfter);
  return true;
}

DESCRIBE_IF('E2E: Hapoalim warm start (real credentials, opt-in)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it(`warm ${WARM_KIND}: completes within its SMS allowance`, async () => {
    const kind = WARM_KIND as Exclude<HapoalimWarmRunKind, 'off'>;
    const run = await runWarmScrape(kind);
    const isAsserted = kind === 'enroll' ? assertEnrollment(run) : assertResume(run);
    expect(isAsserted).toBe(true);
    logScrapedTransactions(run.result);
  });
});
