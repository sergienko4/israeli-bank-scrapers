/**
 * FIBI group browserless refusals — mocked E2E. Each login, envelope, page,
 * hand-off or SSO answer off the recorded contract, and a data read the bank
 * fails, fails the run with the error type the contract maps it to, before any later
 * call; no failure carries the bank's own text.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import { FIBI_MOCK_BRANDS } from './BeinleumiBrands.js';
import type { BeinleumiFault } from './BeinleumiFaults.js';
import { BN_BANK_NOTICE } from './BeinleumiMockData.js';
import type { IRunSetup } from './BeinleumiRun.js';
import { OPENING_TRAIL, PORTAL_TRAIL, runBeinleumi, SCRAPE_TRAIL } from './BeinleumiRun.js';

/** One refused run: how the bank misbehaves, and how the run must end. */
interface IRefusal {
  readonly label: string;
  readonly fault: BeinleumiFault;
  readonly setup: IRunSetup;
  readonly errorType: ScraperErrorTypes;
  readonly message: string;
  readonly trail: readonly string[];
}

/** The login up to and including the call the bank's answer was refused at. */
const TO_LOGIN = OPENING_TRAIL.slice(0, OPENING_TRAIL.indexOf('login') + 1);
const TO_BOOTSTRAP = [
  ...OPENING_TRAIL,
  ...PORTAL_TRAIL.slice(0, PORTAL_TRAIL.indexOf('bootstrap') + 1),
];

const TO_ACCOUNT_TYPE = [
  ...OPENING_TRAIL,
  ...PORTAL_TRAIL,
  ...SCRAPE_TRAIL.slice(0, SCRAPE_TRAIL.indexOf('accountType') + 1),
];

const WRONG_PASSWORD = { creds: { password: 'syn-Wrong-99' } };

const REFUSALS: readonly IRefusal[] = [
  {
    label: 'a wrong password',
    fault: 'none',
    setup: WRONG_PASSWORD,
    errorType: ScraperErrorTypes.InvalidPassword,
    message: 'assertPassword bank error',
    trail: OPENING_TRAIL,
  },
  {
    label: 'a locked account',
    fault: 'locked',
    setup: {},
    errorType: ScraperErrorTypes.AccountBlocked,
    message: 'login answer locked',
    trail: TO_LOGIN,
  },
  {
    label: 'an expired password',
    fault: 'expired',
    setup: {},
    errorType: ScraperErrorTypes.ChangePassword,
    message: 'login answer expired',
    trail: TO_LOGIN,
  },
  {
    label: 'a completion sent outside the envelope',
    fault: 'plaintextAssert',
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: 'assertPassword envelope invalid',
    trail: OPENING_TRAIL,
  },
  {
    label: 'an SSO answer of 204',
    fault: 'sso204',
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: 'bootstrap HTTP 204',
    trail: TO_BOOTSTRAP,
  },
  {
    label: 'an account-type lookup the bank fails',
    fault: 'accountType500',
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: 'customer HTTP 500',
    trail: TO_ACCOUNT_TYPE,
  },
];

describe.each(FIBI_MOCK_BRANDS)('$companyId browserless refusals', (brand): void => {
  it.each(REFUSALS)('refuses $label', async refusal => {
    const run = await runBeinleumi(refusal.fault, { ...refusal.setup, brand });
    expect(run.state.violations).toEqual([]);
    expect(run.result).toMatchObject({ success: false, errorType: refusal.errorType });
    expect(run.result.errorMessage).toContain(refusal.message);
    expect(run.result.errorMessage).not.toContain(BN_BANK_NOTICE);
    expect(run.trail).toEqual(refusal.trail);
  });

  it('never repeats the bank own text on a wrong password', async () => {
    const run = await runBeinleumi('none', { ...WRONG_PASSWORD, brand });
    expect(run.result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(run.result.errorMessage).not.toContain(BN_BANK_NOTICE);
  });
});
