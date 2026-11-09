/**
 * Hapoalim mocked run — one scrape through the public factory against the
 * synthetic bank, recording every call and every OTP prompt.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import type { HapoalimFault } from './HapoalimFaults.js';
import { classifyHapoalim, installHapoalimFetchMock } from './HapoalimFetchMock.js';
import {
  HAPOALIM_MOCK_CREDS,
  HAPOALIM_MOCK_START_DATE,
  HAPOALIM_OPEN_ACCOUNTS,
  HP_OTP,
} from './HapoalimMockData.js';

/** What one run sent, received and asked the caller for. */
export interface IHapoalimRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  readonly trail: readonly string[];
  readonly data: readonly IRecordedCall[];
  /** The hint each retriever call received, in order. */
  readonly hints: readonly string[];
}

/**
 * Credential overrides, the code the SMS retriever answers (false: none), and
 * where the run hands it: the credentials (default) or the scraper options.
 */
export interface IRunSetup {
  readonly creds?: Readonly<Record<string, string>>;
  readonly otp?: string | false;
  readonly retrieverIn?: 'creds' | 'options';
}

/** The SMS retriever, or nothing when the run supplies none. */
type RetrieverSlot = Readonly<{ otpCodeRetriever?: (hint: string) => Promise<string> }>;

/** Login up to the password check. */
export const VERIFY_TRAIL = [
  'GET /ng-portals/auth/he/',
  'GET /ng-portals/auth/serial-number',
  'POST /authenticate/init',
  'POST /authenticate/verify',
];

/** The SMS challenge. */
export const OTP_TRAIL = ['POST /authenticate/logonotp/init', 'POST /authenticate/logonotp/verify'];

/** The portal init, and the accounts list. */
export const LANDING_TRAIL = ['GET /ServerServices/landing-page'];
export const ACCOUNTS_TRAIL = ['GET /ServerServices/general/accounts'];

/** One open account's balance, then its first movements page. */
export const ACCOUNT_OPEN_TRAIL = [
  'GET /ServerServices/current-account/composite/balanceAndCreditLimit',
  'POST /ServerServices/current-account/transactions',
];

/**
 * One open account's reads: balance, first movements page, then one backfill
 * round. The oldest synthetic row is newer than the window start, so the
 * driver asks again up to that row; the reply adds no older row and the round
 * ends.
 */
export const ACCOUNT_TRAIL = [...ACCOUNT_OPEN_TRAIL, ACCOUNT_OPEN_TRAIL[1]];

/** A cold sign-in through the SMS step, ending at the portal init. */
export const SIGNED_IN_TRAIL = [...VERIFY_TRAIL, ...OTP_TRAIL, ...LANDING_TRAIL];

/** Everything after sign-in: the accounts list, then each open account's reads. */
export const SCRAPE_TRAIL = [
  ...ACCOUNTS_TRAIL,
  ...HAPOALIM_OPEN_ACCOUNTS.flatMap(() => ACCOUNT_TRAIL),
];

/**
 * A call as `<METHOD> <path>`; queries are asserted by the wire suite.
 * @param call - The recorded request.
 * @returns The trail entry.
 */
export function trailOf(call: IRecordedCall): string {
  const { pathname } = new URL(call.url);
  return `${call.method} ${pathname}`;
}

/**
 * Whether a call is a data read.
 * @param call - The recorded request.
 * @returns True for accounts, balance and movements.
 */
function isDataCall(call: IRecordedCall): boolean {
  return classifyHapoalim(call) === 'graphql';
}

/**
 * The SMS retriever the run supplies.
 * @param setup - The retriever's code (false: none).
 * @param hints - Receives each retriever call's hint.
 * @returns The retriever slot, empty when the run supplies none.
 */
function retrieverOf(setup: IRunSetup, hints: string[]): RetrieverSlot {
  if (setup.otp === false) return {};
  const code = setup.otp ?? HP_OTP;
  /**
   * The SMS retriever: records the hint, answers the run's code.
   * @param hint - The masked phone the bank reported.
   * @returns The code.
   */
  const otpCodeRetriever = (hint: string): Promise<string> => {
    hints.push(hint);
    return Promise.resolve(code);
  };
  return { otpCodeRetriever };
}

/**
 * The credentials a run signs in with.
 * @param setup - Overrides and where the retriever goes.
 * @param retriever - The run's retriever slot.
 * @returns The credentials.
 */
function credsOf(setup: IRunSetup, retriever: RetrieverSlot): ScraperCredentials {
  const base = { ...HAPOALIM_MOCK_CREDS, ...setup.creds };
  if (setup.retrieverIn === 'options') return base;
  return { ...base, ...retriever };
}

/**
 * The scraper options a run is created with.
 * @param setup - Where the retriever goes.
 * @param retriever - The run's retriever slot.
 * @returns The options.
 */
function optionsOf(setup: IRunSetup, retriever: RetrieverSlot): ScraperOptions {
  const options = { companyId: CompanyTypes.Hapoalim, startDate: HAPOALIM_MOCK_START_DATE };
  if (setup.retrieverIn !== 'options') return options;
  return { ...options, ...retriever };
}

/**
 * Scrape the synthetic bank once.
 * @param fault - How the bank misbehaves.
 * @param setup - Credential overrides and the retriever's code.
 * @returns What the run sent, received and asked for.
 */
export async function runHapoalim(
  fault: HapoalimFault = 'none',
  setup: IRunSetup = {},
): Promise<IHapoalimRun> {
  const hints: string[] = [];
  const retriever = retrieverOf(setup, hints);
  const creds = credsOf(setup, retriever);
  const options = optionsOf(setup, retriever);
  const handle = installHapoalimFetchMock(fault);
  try {
    const result = await createScraper(options).scrape(creds);
    const calls = handle.calls();
    const data = calls.filter(isDataCall);
    return { result, calls, trail: calls.map(trailOf), data, hints };
  } finally {
    handle.dispose();
  }
}
