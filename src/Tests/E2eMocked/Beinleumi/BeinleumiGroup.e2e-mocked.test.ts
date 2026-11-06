/**
 * Beinleumi group siblings — mocked E2E. Each sibling runs Beinleumi's
 * browserless login on its own online origin, portal, Transmit app, bank
 * number and device-memory provider. The synthetic bank, bound to the
 * sibling's brand, checks every call: a cold run that enrolls the device, an
 * SMS step the bank asks for, a resume with the stored device, and a device
 * stored for Beinleumi, which the sibling refuses.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import { decodeDeviceMemoryState } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceMemoryStateCodec.js';
import { BEINLEUMI_MOCK_BRAND, SIBLING_MOCK_BRANDS } from './BeinleumiBrands.js';
import { BN_ACCOUNT, BN_BALANCE, BN_DID, BN_STORED_DID } from './BeinleumiMockData.js';
import type { IBeinleumiRun } from './BeinleumiRun.js';
import {
  COLD_TRAIL,
  didsOf,
  OPENING_TRAIL,
  OTP_TRAIL,
  PORTAL_TRAIL,
  runBeinleumi,
  SCRAPE_TRAIL,
} from './BeinleumiRun.js';
import { ownerOf } from './BeinleumiRunInputs.js';

/** A run the bank asks a triggered code of, end to end. */
const GENERATE_TRAIL = [...OPENING_TRAIL, ...OTP_TRAIL, ...PORTAL_TRAIL, ...SCRAPE_TRAIL];

/** A resume: the stored device id, and a callback that records. */
const RESUME = { storedDid: BN_STORED_DID, callback: 'record' } as const;

/**
 * Expect a run to have signed in and scraped, every call on spec, with no browser.
 * @param run - The run.
 * @param trail - The calls it must have made.
 * @returns True once checked.
 */
function expectSignedIn(run: IBeinleumiRun, trail: readonly string[]): boolean {
  expect(run.state.violations).toEqual([]);
  expect(run.result.errorMessage).toBeUndefined();
  expect(run.result.success).toBe(true);
  expect(run.trail).toEqual(trail);
  expect(run.launches).toBe(0);
  return true;
}

describe.each(SIBLING_MOCK_BRANDS)('$companyId browserless login (Beinleumi group)', brand => {
  it('signs in cold, scrapes, and enrolls the device for its own provider', async () => {
    const run = await runBeinleumi('none', { brand, callback: 'record' });
    expectSignedIn(run, COLD_TRAIL);
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(acct => ({ number: acct.accountNumber, balance: acct.balance }));
    expect(summary).toEqual([{ number: BN_ACCOUNT.account, balance: BN_BALANCE }]);
    expect(run.published).toHaveLength(1);
    const owner = ownerOf(brand);
    const decoded = decodeDeviceMemoryState(run.published[0], owner);
    expect(decoded).toMatchObject({ success: true, value: { deviceId: BN_DID } });
  });

  it('signs in through an SMS step the bank asks for, asking the caller once', async () => {
    const run = await runBeinleumi('otpGenerate', { brand });
    expectSignedIn(run, GENERATE_TRAIL);
    expect(run.hints).toEqual(['']);
  });

  it('resumes with the stored device on every Transmit call and publishes nothing', async () => {
    const run = await runBeinleumi('none', { ...RESUME, brand });
    expectSignedIn(run, COLD_TRAIL);
    const dids = didsOf(run);
    expect(dids).toEqual([BN_STORED_DID, BN_STORED_DID, BN_STORED_DID]);
    expect(run.published).toEqual([]);
  });

  it('refuses a device stored for Beinleumi before any call', async () => {
    const run = await runBeinleumi('none', { ...RESUME, brand, stateBrand: BEINLEUMI_MOCK_BRAND });
    expect(run.result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(run.result.errorMessage).toContain('persistent auth state invalid: provider');
    expect(run.calls).toEqual([]);
  });
});
