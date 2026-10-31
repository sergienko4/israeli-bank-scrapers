/**
 * Hapoalim browserless login — mocked E2E for the outcomes: a cold run with
 * the SMS step and no browser, a run the bank lets skip the SMS, each
 * password-step refusal, a refused replay, bank errors and invalid answers,
 * empty and partial movement pages, a lost session and every way step 0 can
 * fail. The SMS step's own edges live in HapoalimOtp, the wire in HapoalimWire.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import { HP_FOREIGN_TARGET, HP_VERIFY_REPLAY_URL } from './HapoalimAuthRoutes.js';
import type { HapoalimFault } from './HapoalimFaults.js';
import { HP_BANK_NOTICE } from './HapoalimFaults.js';
import {
  compositeOf,
  HAPOALIM_MOCK_CREDS,
  HAPOALIM_OPEN_ACCOUNTS,
  HP_PHONE,
} from './HapoalimMockData.js';
import {
  ACCOUNT_OPEN_TRAIL,
  ACCOUNT_TRAIL,
  ACCOUNTS_TRAIL,
  LANDING_TRAIL,
  OTP_TRAIL,
  runHapoalim,
  VERIFY_TRAIL,
} from './HapoalimRun.js';

/** A run Hapoalim refuses: the fault, the failure and how far the run got. */
interface IRefusal {
  readonly fault: HapoalimFault;
  readonly errorType: ScraperErrorTypes;
  readonly message: string;
  readonly trail: readonly string[];
}

const SIGNED_IN_TRAIL = [...VERIFY_TRAIL, ...OTP_TRAIL, ...LANDING_TRAIL];

/** Everything after sign-in: the accounts list, then each open account's reads. */
const SCRAPE_TRAIL = [...ACCOUNTS_TRAIL, ...HAPOALIM_OPEN_ACCOUNTS.flatMap(() => ACCOUNT_TRAIL)];

/** Answers to the password step that end the run before any SMS is sent. */
const VERIFY_REFUSALS: readonly IRefusal[] = [
  {
    fault: 'locked',
    errorType: ScraperErrorTypes.AccountBlocked,
    message: 'verify outcome locked',
    trail: VERIFY_TRAIL,
  },
  {
    fault: 'reissue',
    errorType: ScraperErrorTypes.ChangePassword,
    message: 'verify outcome reissue',
    trail: VERIFY_TRAIL,
  },
  {
    fault: 'unknownState',
    errorType: ScraperErrorTypes.Generic,
    message: 'verify outcome unmapped',
    trail: VERIFY_TRAIL,
  },
  {
    fault: 'verifyErrors',
    errorType: ScraperErrorTypes.Generic,
    message: 'verify bank error',
    trail: VERIFY_TRAIL,
  },
  {
    fault: 'foreignTarget',
    errorType: ScraperErrorTypes.Generic,
    message: 'verify extract target invalid',
    trail: VERIFY_TRAIL,
  },
  {
    fault: 'targetNumber',
    errorType: ScraperErrorTypes.Generic,
    message: 'verify extract target invalid',
    trail: VERIFY_TRAIL,
  },
];

/** Invalid answers before or after the SMS step, and where each stops the run. */
const ANSWER_REFUSALS: readonly IRefusal[] = [
  {
    fault: 'initResultString',
    errorType: ScraperErrorTypes.Generic,
    message: 'identify extract result invalid',
    trail: VERIFY_TRAIL.slice(0, 3),
  },
  {
    fault: 'initResultMissing',
    errorType: ScraperErrorTypes.Generic,
    message: 'envelope selector miss: result at /result',
    trail: VERIFY_TRAIL.slice(0, 3),
  },
  {
    fault: 'pageIdBad',
    errorType: ScraperErrorTypes.Generic,
    message: 'landing extract pageId invalid',
    trail: SIGNED_IN_TRAIL,
  },
  {
    fault: 'landingErrors',
    errorType: ScraperErrorTypes.Generic,
    message: 'landing bank error',
    trail: SIGNED_IN_TRAIL,
  },
];

/** Step-0 faults and the failure each must surface, with no response text. */
const STEP_ZERO_FAULTS: readonly (readonly [HapoalimFault, ScraperErrorTypes, string])[] = [
  ['http500', ScraperErrorTypes.Generic, 'bootstrap HTTP 500'],
  ['reject', ScraperErrorTypes.Generic, 'bootstrap GENERIC'],
  ['timeout', ScraperErrorTypes.Timeout, 'bootstrap TIMEOUT'],
];

/**
 * Assert a run failed as a refusal says, without the bank's own text.
 * @param refusal - The expected failure.
 * @returns Resolves once every check has run.
 */
async function expectRefused(refusal: IRefusal): Promise<void> {
  const run = await runHapoalim(refusal.fault);
  expect(run.result.success).toBe(false);
  expect(run.result.errorType).toBe(refusal.errorType);
  expect(run.result.errorMessage).toBe(refusal.message);
  expect(run.result.errorMessage).not.toContain(HP_BANK_NOTICE);
  expect(run.trail).toEqual(refusal.trail);
}

describe('Hapoalim browserless login', () => {
  it('signs in cold through the SMS step, asks once with the phone hint, launches no browser', async () => {
    const run = await runHapoalim();
    expect(run.result.success).toBe(true);
    expect(run.launches).toBe(0);
    expect(run.trail).toEqual([...SIGNED_IN_TRAIL, ...SCRAPE_TRAIL]);
    expect(run.hints).toEqual([HP_PHONE]);
  });

  it('asks the retriever passed in the scraper options, as the browser login did', async () => {
    const run = await runHapoalim('none', { retrieverIn: 'options' });
    expect(run.result.success).toBe(true);
    expect(run.hints).toEqual([HP_PHONE]);
  });

  it('reports each open account with its own balance and movements, and skips a closed one', async () => {
    const run = await runHapoalim();
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(account => [
      account.accountNumber,
      account.balance,
      account.txns.map(txn => txn.chargedAmount),
    ]);
    const expected = HAPOALIM_OPEN_ACCOUNTS.map(acct => [
      compositeOf(acct),
      acct.balance,
      acct.amounts,
    ]);
    expect(summary).toEqual(expected);
  });

  it('skips the SMS step when the bank answers landpage, and never asks for a code', async () => {
    const run = await runHapoalim('landpage');
    expect(run.result.success).toBe(true);
    expect(run.trail).toEqual([...VERIFY_TRAIL, ...LANDING_TRAIL, ...SCRAPE_TRAIL]);
    expect(run.hints).toEqual([]);
  });

  it.each(VERIFY_REFUSALS)('fails a verify $fault before any SMS', async refusal => {
    await expectRefused(refusal);
  });

  it.each(ANSWER_REFUSALS)('fails an invalid $fault answer', async refusal => {
    await expectRefused(refusal);
  });

  it('never names a foreign landing target in the failure', async () => {
    const run = await runHapoalim('foreignTarget');
    expect(run.result.errorMessage).not.toContain(new URL(HP_FOREIGN_TARGET).host);
  });

  it.each(['verify302', 'verify307'] as const)(
    'refuses a %s and never replays the credentials',
    async fault => {
      const run = await runHapoalim(fault);
      const status = fault.slice('verify'.length);
      expect(run.result.success).toBe(false);
      expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(run.result.errorMessage).toBe(`verify HTTP ${status} redirect refused`);
      expect(run.trail).toEqual(VERIFY_TRAIL);
      const urls = run.calls.map(call => call.url);
      expect(urls).not.toContain(HP_VERIFY_REPLAY_URL);
    },
  );

  it('reads an empty 204 movements page as no movements', async () => {
    const run = await runHapoalim('txns204');
    expect(run.result.success).toBe(true);
    const counts = (run.result.accounts ?? []).map(account => account.txns.length);
    expect(counts).toEqual([0, 0]);
  });

  it('fails a 207 partial movements page instead of reading it as complete', async () => {
    const run = await runHapoalim('txns207');
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toContain('HTTP 207');
  });

  it('fails a lost session mid-scrape without signing in again', async () => {
    const run = await runHapoalim('expire401');
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.trail).toEqual([...SIGNED_IN_TRAIL, ...ACCOUNTS_TRAIL, ...ACCOUNT_OPEN_TRAIL]);
    expect(run.hints).toEqual([HP_PHONE]);
  });

  it.each(STEP_ZERO_FAULTS)(
    'fails a step-0 %s after one call, with no retry and no response text',
    async (fault, errorType, message) => {
      const run = await runHapoalim(fault);
      expect(run.result.success).toBe(false);
      expect(run.result.errorType).toBe(errorType);
      expect(run.result.errorMessage).toBe(message);
      expect(run.calls).toHaveLength(1);
    },
  );

  it('rejects an empty password before sending any request', async () => {
    const creds = { ...HAPOALIM_MOCK_CREDS, password: '' };
    const run = await runHapoalim('none', { creds });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('Missing or malformed credentials: password');
    expect(run.calls).toHaveLength(0);
  });
});
