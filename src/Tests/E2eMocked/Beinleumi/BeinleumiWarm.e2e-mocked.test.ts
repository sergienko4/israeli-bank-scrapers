/**
 * Beinleumi browserless device memory — mocked E2E. A caller that supplies a
 * storage callback and no state enrolls: the run publishes the device id the
 * bank issued, once. A caller that hands that state back resumes: every
 * Transmit call names the stored id, even when the bank answers a different
 * one, and nothing new is published. A state for another account, or a
 * callback that refuses to store, fails the run by category only.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import { decodeDeviceMemoryState } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceMemoryStateCodec.js';
import { BN_DID, BN_STORED_DID } from './BeinleumiMockData.js';
import type { IBeinleumiRun } from './BeinleumiRun.js';
import { COLD_TRAIL, runBeinleumi } from './BeinleumiRun.js';
import { BN_OWNER } from './BeinleumiRunInputs.js';
import { WIRE_PATHS } from './BeinleumiWireSpec.js';

/** Every Transmit path: the key exchange, the login and the assertions. */
const TRANSMIT_PATHS: readonly string[] = [
  WIRE_PATHS.keyExchange,
  WIRE_PATHS.login,
  WIRE_PATHS.assert,
];

/** A resume: the stored device id, and a callback that records. */
const RESUME = { storedDid: BN_STORED_DID, callback: 'record' } as const;

/**
 * The device id each Transmit call named, in order.
 * @param run - The run.
 * @returns One `did` per Transmit call ('' when it named none).
 */
function didsOf(run: IBeinleumiRun): readonly string[] {
  const urls = run.calls.map(call => new URL(call.url));
  const transmit = urls.filter(url => TRANSMIT_PATHS.includes(url.pathname));
  return transmit.map(url => url.searchParams.get('did') ?? '');
}

describe('Beinleumi browserless device memory', () => {
  it('enrolls: publishes the device id the bank issued, once', async () => {
    const run = await runBeinleumi('none', { callback: 'record' });
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(true);
    expect(run.trail).toEqual(COLD_TRAIL);
    expect(run.published).toHaveLength(1);
    const decoded = decodeDeviceMemoryState(run.published[0], BN_OWNER);
    expect(decoded).toMatchObject({ success: true, value: { deviceId: BN_DID } });
  });

  it('enrolls with the id the key exchange issued on every later Transmit call', async () => {
    const run = await runBeinleumi('none', { callback: 'record' });
    const dids = didsOf(run);
    expect(dids).toEqual(['', BN_DID, BN_DID]);
  });

  it('resumes with the stored id on every Transmit call and publishes nothing', async () => {
    const run = await runBeinleumi('none', RESUME);
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(true);
    const dids = didsOf(run);
    expect(run.trail).toEqual(COLD_TRAIL);
    expect(dids).toEqual([BN_STORED_DID, BN_STORED_DID, BN_STORED_DID]);
    expect(run.published).toEqual([]);
    expect(run.launches).toBe(0);
  });

  it('keeps the stored id through an SMS step the bank still asks for', async () => {
    const run = await runBeinleumi('otpGenerate', RESUME);
    expect(run.state.violations).toEqual([]);
    const dids = didsOf(run);
    expect(run.result.success).toBe(true);
    expect(dids).toEqual([
      BN_STORED_DID,
      BN_STORED_DID,
      BN_STORED_DID,
      BN_STORED_DID,
      BN_STORED_DID,
    ]);
    expect(run.published).toEqual([]);
  });

  it('refuses a state stored for another account before any call', async () => {
    const run = await runBeinleumi('none', { ...RESUME, stateAccount: 'synother07' });
    expect(run.result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(run.result.errorMessage).toContain('persistent auth state invalid: account');
    expect(run.calls).toEqual([]);
    expect(run.published).toEqual([]);
  });

  it('fails by category when the callback refuses to store the enrolled state', async () => {
    const run = await runBeinleumi('none', { callback: 'reject' });
    expect(run.state.violations).toEqual([]);
    expect(run.result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(run.result.errorMessage).toContain('persistent auth failed: callback');
    expect(run.result.errorMessage).not.toContain(BN_DID);
    expect(run.trail).not.toContain('userData');
  });
});
