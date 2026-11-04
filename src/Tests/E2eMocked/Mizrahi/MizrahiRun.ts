/**
 * Mizrahi mocked-run helpers — scrape against the synthetic bank and slice
 * the call log the way the mocked E2E suites assert it.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
} from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import { getLaunchCount } from '../../Mocks/CamoufoxJsMock.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import type { MizrahiFault } from './MizrahiFetchMock.js';
import { classifyMizrahi, installMizrahiFetchMock } from './MizrahiFetchMock.js';
import { MIZRAHI_MOCK_CREDS, MIZRAHI_MOCK_START_DATE } from './MizrahiMockData.js';

/** What one mocked run produced. */
export interface IMizrahiRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  /** `<METHOD> <path><query>` of each call, in order. */
  readonly trail: readonly string[];
  /** Every data call (changeAccount, get428Index). */
  readonly data: readonly IRecordedCall[];
  readonly launches: number;
}

/** The login trail up to and including LoginUser. */
export const LOGIN_TRAIL = ['GET /login/index.html', 'POST /login/api/Login/LoginUser'];

/** The landing hops and logon after a successful LoginUser. */
export const HANDOFF_TRAIL = [
  'GET /Online/Default.aspx?language=he-IL',
  'GET /Online/Default.aspx',
  'GET /Online/Default.aspx?language=he-IL',
  'POST /Online/api/SkyBL/logon',
];

/** One account's switch, then its first movements page. */
export const ACCOUNT_OPEN_TRAIL = [
  'POST /Online/api/SkyBL/changeAccount',
  'POST /Online/api/SkyOSH/get428Index',
];

/**
 * One account's data calls: switch, first page, then one backfill round. The
 * oldest synthetic row is newer than the window start, so the driver asks
 * again up to that row; the reply adds no older row and the round ends.
 */
export const ACCOUNT_TRAIL = [...ACCOUNT_OPEN_TRAIL, 'POST /Online/api/SkyOSH/get428Index'];

/**
 * A call's trail entry.
 * @param call - A recorded call.
 * @returns `<METHOD> <path><query>`.
 */
export function trailOf(call: IRecordedCall): string {
  const { pathname, search } = new URL(call.url);
  return `${call.method} ${pathname}${search}`;
}

/**
 * Whether a call was a data call.
 * @param call - A recorded call.
 * @returns True for changeAccount and get428Index.
 */
function isDataCall(call: IRecordedCall): boolean {
  return classifyMizrahi(call) === 'graphql';
}

/**
 * Scrape Mizrahi against the synthetic bank.
 * @param fault - Fault the bank answers with.
 * @param creds - Credentials to scrape with.
 * @returns The result, the call log and how many browsers were launched.
 */
export async function runMizrahi(
  fault: MizrahiFault = 'none',
  creds: ScraperCredentials = { ...MIZRAHI_MOCK_CREDS },
): Promise<IMizrahiRun> {
  const launchesBefore = getLaunchCount();
  const handle = installMizrahiFetchMock(fault);
  try {
    const options = { companyId: CompanyTypes.Mizrahi, startDate: MIZRAHI_MOCK_START_DATE };
    const scraper = createScraper(options);
    const result = await scraper.scrape(creds);
    const launches = getLaunchCount() - launchesBefore;
    const calls = handle.calls();
    const data = calls.filter(isDataCall);
    return { result, calls, trail: calls.map(trailOf), data, launches };
  } finally {
    handle.dispose();
  }
}
