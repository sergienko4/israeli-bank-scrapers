/**
 * Beinleumi HTTP-only login and scrape — mocked E2E. A cold run reads the
 * login page, opens a Transmit envelope, asserts the password, posts the
 * login form back with the Transmit token, follows the portal hand-off and
 * trades the SSO code for the authorization the BFF reads carry. Every call
 * is checked against the recorded contract by the synthetic bank.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { BN_ACCOUNT, BN_BALANCE } from './BeinleumiMockData.js';
import type { IBeinleumiRun } from './BeinleumiRun.js';
import { COLD_TRAIL, runBeinleumi } from './BeinleumiRun.js';

describe('Beinleumi browserless login and scrape (cold, no SMS)', () => {
  let run: IBeinleumiRun;

  beforeAll(async (): Promise<void> => {
    run = await runBeinleumi();
  });

  it('signs in and scrapes with every call on spec', () => {
    expect(run.state.violations).toEqual([]);
    expect(run.result.errorMessage).toBeUndefined();
    expect(run.result.success).toBe(true);
    expect(run.trail).toEqual(COLD_TRAIL);
  });

  it('asks the caller for no code and publishes no device state', () => {
    expect(run.hints).toEqual([]);
    expect(run.published).toEqual([]);
  });

  it('reads only the account the user selected, with its current balance', () => {
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(acct => ({ number: acct.accountNumber, balance: acct.balance }));
    expect(summary).toEqual([{ number: BN_ACCOUNT.account, balance: BN_BALANCE }]);
  });

  it('maps each movement, credit less debit, by its description', () => {
    const txns = run.result.accounts?.[0].txns ?? [];
    const mapped = txns.map(txn => ({ description: txn.description, amount: txn.chargedAmount }));
    expect(mapped).toEqual([
      { description: 'SYN-PAYMENT-A', amount: -120.5 },
      { description: 'SYN-CREDIT-B', amount: 300 },
    ]);
  });
});
