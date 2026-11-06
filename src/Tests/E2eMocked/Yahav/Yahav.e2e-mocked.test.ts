/**
 * Yahav native login and scrape — mocked E2E. A cold run initializes the app
 * client, registers the device with a certification request the bank checks,
 * takes a bearer token over the issued certificate, opens a BaNCS session and
 * reads every shekel current account, each read echoing the latest rotated
 * session. Every call is checked against the recorded contract by the
 * synthetic bank.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { openTestCsr } from '../../Helpers/TestCsr.js';
import type { IBancsWindow } from './YahavBancsData.js';
import {
  daysAgo,
  YAHAV_MOCK_CREDS,
  YAHAV_MOCK_START_DATE,
  YH_ACCOUNTS,
  YH_CLIENT_SECRET,
  YH_TXN_DAYS,
} from './YahavMockData.js';
import type { IYahavRun } from './YahavRun.js';
import { COLD_TRAIL, foldedTrail, runYahav, txnWindows } from './YahavRun.js';

/**
 * A day as ISO text.
 * @param date - Midnight UTC of the day.
 * @returns `YYYY-MM-DD`.
 */
function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Today and the window start as ISO days.
 * @returns The scrape window's first and last day.
 */
function scrapeDays(): { readonly first: string; readonly last: string } {
  return { first: dayOf(YAHAV_MOCK_START_DATE), last: dayOf(new Date()) };
}

/**
 * The ISO day after another.
 * @param iso - An ISO day.
 * @returns The next ISO day.
 */
function dayAfter(iso: string): string {
  const next = new Date(`${iso}T00:00:00.000Z`).getTime() + 86_400_000;
  return new Date(next).toISOString().slice(0, 10);
}

/**
 * Whether successive windows leave no calendar-day gap.
 * @param windows - Consecutive date windows.
 * @returns True when every window starts the day after the previous one.
 */
function areContiguous(windows: readonly IBancsWindow[]): boolean {
  return windows.slice(1).every((window, at) => dayAfter(windows[at].to) === window.from);
}

describe('Yahav native login and scrape (cold)', () => {
  let run: IYahavRun;

  beforeAll(async (): Promise<void> => {
    run = await runYahav();
  });

  it('signs in and scrapes with every call on spec, launching no browser', () => {
    expect(run.state.violations).toEqual([]);
    expect(run.result.errorMessage).toBeUndefined();
    const trail = foldedTrail(run);
    expect(run.result.success).toBe(true);
    expect(trail).toEqual(COLD_TRAIL);
    expect(run.launches).toBe(0);
  });

  it('sends a verifiable certification request to register the device', () => {
    const request = run.calls[1]?.body ?? '';
    const isBase64Url = /^[\w-]+$/.test(request);
    const parsedCsr = openTestCsr(request);
    expect(request.length).toBeGreaterThan(500);
    expect(isBase64Url).toBe(true);
    expect(parsedCsr).not.toBe(false);
  });

  it('reads each shekel account by its bank id, with its current balance', () => {
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(acct => ({ number: acct.accountNumber, balance: acct.balance }));
    const expected = YH_ACCOUNTS.map(acct => ({ number: acct.id, balance: Number(acct.balance) }));
    expect(summary).toEqual(expected);
  });

  it('keeps only each account own movements, signed by their type', () => {
    const accounts = run.result.accounts ?? [];
    const amounts = accounts.map(acct => acct.txns.map(txn => txn.chargedAmount).sort());
    const identifiers = accounts.map(acct => acct.txns.map(txn => String(txn.identifier)).sort());
    const ownIdentifiers = YH_ACCOUNTS.map(acct => [
      `SYN-txn-${acct.id}-0`,
      `SYN-txn-${acct.id}-1`,
    ]);
    expect(amounts).toEqual([
      [-12.5, 300],
      [-12.5, 300],
    ]);
    expect(identifiers).toEqual(ownIdentifiers);
  });

  it('asks each account for contiguous month windows, then backfills up to its oldest movement', () => {
    const windows = txnWindows(run);
    const perAccount = windows.length / YH_ACCOUNTS.length;
    const own = windows.slice(0, perAccount);
    const firstRepeat = own.findIndex((window, at) => at > 0 && window.from === own[0].from);
    const tiles = own.slice(0, firstRepeat);
    const backfill = own.slice(firstRepeat);
    const days = scrapeDays();
    const oldestDaysAgo = Math.max(...YH_TXN_DAYS);
    const oldestDate = daysAgo(oldestDaysAgo);
    const backfillEnd = dayOf(oldestDate);
    const otherAccount = windows.slice(perAccount);
    const isTileWalkContiguous = areContiguous(tiles);
    const isBackfillContiguous = areContiguous(backfill);
    expect(firstRepeat).toBeGreaterThan(0);
    expect(otherAccount).toEqual(own);
    expect(isTileWalkContiguous).toBe(true);
    expect(isBackfillContiguous).toBe(true);
    expect(tiles[0].from <= days.first).toBe(true);
    expect(String(tiles.at(-1)?.to) >= days.last).toBe(true);
    expect(backfill[0].from).toBe(tiles[0].from);
    expect(backfill.at(-1)?.to).toBe(backfillEnd);
  });

  it('presents no certificate before register and the issued one after', () => {
    const presented = run.state.presentedLog;
    const beforeRegister = presented.slice(0, 2);
    const afterRegister = presented.slice(2).map(cert => (cert === false ? '' : cert.sha256));
    expect(beforeRegister).toEqual([false, false]);
    expect(afterRegister).not.toContain('');
    expect(new Set(afterRegister).size).toBe(1);
  });

  it('publishes a stored token and leaks no secret into the result', () => {
    const { persistentOtpToken, ...rest } = run.result;
    const text = JSON.stringify(rest);
    expect(typeof persistentOtpToken).toBe('string');
    expect(text).not.toContain(YAHAV_MOCK_CREDS.password);
    expect(text).not.toContain(YH_CLIENT_SECRET);
  });
});
