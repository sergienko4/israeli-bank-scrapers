/**
 * Yahav mocked run — one scrape through the public factory against the
 * synthetic bank, recording every call by name and every wire check it failed.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import type { IScraperScrapingResult } from '../../../Scrapers/Base/Interface.js';
import { YAHAV_AUTH_PATHS } from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigYahavConstants.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import type { IBancsWindow } from './YahavBancsData.js';
import { bancsCallOf, windowOf } from './YahavBancsRoutes.js';
import type { IYahavMockState, YahavFault } from './YahavFaults.js';
import { freshState } from './YahavFaults.js';
import { installYahavFetchMock } from './YahavFetchMock.js';
import { YAHAV_MOCK_CREDS, YAHAV_MOCK_START_DATE } from './YahavMockData.js';

/** What one run sent and received, and what the bank found off spec. */
export interface IYahavRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  /** Each call by name: `initialize` … `txns`. */
  readonly trail: readonly string[];
  readonly state: IYahavMockState;
}

/** Credential overrides, such as a stored token. */
export interface IRunSetup {
  readonly creds?: Readonly<Record<string, string>>;
}

const RUN_OPTIONS = { companyId: CompanyTypes.Yahav, startDate: YAHAV_MOCK_START_DATE };

const AUTH_ROUTES = Object.entries(YAHAV_AUTH_PATHS).map(
  ([name, path]): readonly [string, string] => [path, name],
);

const AUTH_NAMES: Readonly<Record<string, string>> = Object.fromEntries(AUTH_ROUTES);

/** The device login a cold run makes. */
export const ENROL_TRAIL = ['initialize', 'register'];

/** The BaNCS session a login opens, then the account list. */
export const BANCS_TRAIL = ['login', 'customer', 'portfolio', 'accounts'];

/** A scrape once the token is granted: the session, then each account's reads. */
export const SCRAPE_TRAIL = [...BANCS_TRAIL, 'balance', 'txns', 'balance', 'txns'];

/** A cold run, end to end. */
export const COLD_TRAIL = [...ENROL_TRAIL, 'token', ...SCRAPE_TRAIL];

/** A warm run, end to end. */
export const WARM_TRAIL = ['token', ...SCRAPE_TRAIL];

/**
 * A call by name.
 * @param call - The recorded request.
 * @returns Its route name, or `<METHOD> <path>` for an unknown one.
 */
function nameOf(call: IRecordedCall): string {
  const { pathname } = new URL(call.url);
  const bancs = bancsCallOf(call);
  if (bancs !== false) return bancs;
  return AUTH_NAMES[pathname] ?? `${call.method} ${pathname}`;
}

/**
 * A run's trail with each account's month chunks folded into one `txns`.
 * @param run - The run.
 * @returns The folded trail.
 */
export function foldedTrail(run: IYahavRun): readonly string[] {
  return run.trail.filter((name, at) => name !== 'txns' || run.trail[at - 1] !== 'txns');
}

/**
 * The cookies a call sent.
 * @param call - The recorded request.
 * @returns Its `name=value` pairs, sorted; empty when it sent none.
 */
export function cookiesOf(call: IRecordedCall): readonly string[] {
  const header = call.headers.get('cookie') ?? '';
  return header.split('; ').filter(Boolean).sort();
}

/**
 * The windows each transactions call asked for, in order.
 * @param run - The run.
 * @returns One window per call.
 */
export function txnWindows(run: IYahavRun): readonly IBancsWindow[] {
  const calls = run.calls.filter(call => bancsCallOf(call) === 'txns');
  return calls.map(windowOf);
}

/**
 * Scrape the synthetic bank once.
 * @param fault - How the bank misbehaves.
 * @param setup - Credential overrides.
 * @returns What the run sent and received.
 */
export async function runYahav(
  fault: YahavFault = 'none',
  setup: IRunSetup = {},
): Promise<IYahavRun> {
  const state = freshState(fault);
  const handle = installYahavFetchMock(state);
  try {
    const result = await createScraper(RUN_OPTIONS).scrape({ ...YAHAV_MOCK_CREDS, ...setup.creds });
    const calls = handle.calls();
    return {
      result,
      calls,
      trail: calls.map(nameOf),
      state,
    };
  } finally {
    handle.dispose();
  }
}

/**
 * Scrape with a stored token.
 * @param token - The token handed to the run.
 * @param fault - How the bank misbehaves.
 * @returns What the run sent and received.
 */
export function runWarm(token: string, fault: YahavFault = 'none'): Promise<IYahavRun> {
  return runYahav(fault, { creds: { otpLongTermToken: token } });
}
