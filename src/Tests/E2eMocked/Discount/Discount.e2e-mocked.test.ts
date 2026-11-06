/**
 * Discount browserless login — mocked E2E for the outcomes: a cold run with
 * no browser, each account's balance and movements, every refusal the login
 * or the data API can give, and the credentials refused before any request.
 * The wire itself (headers, bodies, seals, cookies) lives in DiscountWire.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../Scrapers/Base/Interface.js';
import type { DiscountFault } from './DiscountFaults.js';
import { DC_BANK_NOTICE } from './DiscountFaults.js';
import { DISCOUNT_MOCK_ACCOUNTS, DISCOUNT_MOCK_CREDS } from './DiscountMockData.js';
import {
  ACCOUNTS_TRAIL,
  COLD_TRAIL,
  HANDOFF_TRAIL,
  LOGIN_TRAIL,
  runDiscount,
  SUCCESS_HOP,
} from './DiscountRun.js';

/** A run Discount refuses: the input, the failure it must surface, the calls it makes. */
interface IRefusal {
  readonly name: string;
  readonly fault: DiscountFault;
  readonly creds?: ScraperCredentials;
  readonly errorType: ScraperErrorTypes;
  readonly message: string;
  readonly trail: readonly string[];
}

const GENERIC = ScraperErrorTypes.Generic;
const PRIME_ONLY = LOGIN_TRAIL.slice(0, 1);
const TO_OUTCOME = [...LOGIN_TRAIL, SUCCESS_HOP];

/** Refused runs and the failure each must surface, never with the bank's text. */
const REFUSALS: readonly IRefusal[] = [
  {
    name: 'a wrong password',
    fault: 'none',
    creds: { ...DISCOUNT_MOCK_CREDS, password: 'synthetic-wrong-pass' },
    errorType: ScraperErrorTypes.InvalidPassword,
    message: 'logon answer statusRejected',
    trail: TO_OUTCOME,
  },
  {
    name: 'a step-up the key call asks for',
    fault: 'actionRequired',
    errorType: GENERIC,
    message: 'encryptionKey bank error',
    trail: LOGIN_TRAIL.slice(0, 2),
  },
  {
    name: 'a 307 on login, never replaying the credentials',
    fault: 'login307',
    errorType: GENERIC,
    message: 'logon redirect refused',
    trail: LOGIN_TRAIL,
  },
  {
    name: 'a login redirect with a query',
    fault: 'loginQuery',
    errorType: GENERIC,
    message: 'logon redirect refused',
    trail: LOGIN_TRAIL,
  },
  {
    name: 'a login bound to another id',
    fault: 'mi6Mismatch',
    errorType: GENERIC,
    message: 'logon extract mi6 mismatch',
    trail: TO_OUTCOME,
  },
  {
    name: 'a malformed XSRF token from the login page',
    fault: 'malformedXsrf',
    errorType: GENERIC,
    message: 'encryptionKey GENERIC',
    trail: PRIME_ONLY,
  },
  {
    name: 'a malformed XSRF token set by the login redirect',
    fault: 'malformedHopXsrf',
    errorType: GENERIC,
    message: 'logon GENERIC',
    trail: LOGIN_TRAIL,
  },
  {
    name: 'a login page carrying a CSRF token',
    fault: 'csrfPage',
    errorType: GENERIC,
    message: 'prime capture csrf present',
    trail: PRIME_ONLY,
  },
  {
    name: 'a Titan error',
    fault: 'titanError',
    errorType: GENERIC,
    message: 'titan answer error',
    trail: [...LOGIN_TRAIL, ...HANDOFF_TRAIL, ...ACCOUNTS_TRAIL],
  },
  {
    name: 'a Titan HTTP failure',
    fault: 'titan500',
    errorType: GENERIC,
    message: 'customer HTTP 500',
    trail: [...LOGIN_TRAIL, ...HANDOFF_TRAIL, ...ACCOUNTS_TRAIL],
  },
];

/** Credentials refused before any request, and the failure each surfaces. */
const MALFORMED: readonly (readonly [string, ScraperCredentials, string])[] = [
  [
    'a 10-digit id not starting with 9',
    { ...DISCOUNT_MOCK_CREDS, id: '1123456789' },
    'derivedCarry: uid unformattable',
  ],
  [
    'a password past latin-1',
    { ...DISCOUNT_MOCK_CREDS, password: 'syn-p\u20acss' },
    'Missing or malformed credentials: password',
  ],
];

describe('Discount browserless login', () => {
  it('signs in cold, reads every account and launches no browser', async () => {
    const run = await runDiscount();
    expect(run.result.success).toBe(true);
    expect(run.launches).toBe(0);
    expect(run.trail).toEqual(COLD_TRAIL);
  });

  it('reports each account with its own balance and movements', async () => {
    const run = await runDiscount();
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(account => [
      account.accountNumber,
      account.balance,
      account.txns.map(txn => txn.chargedAmount),
    ]);
    const expected = DISCOUNT_MOCK_ACCOUNTS.map(acct => [acct.display, acct.balance, acct.amounts]);
    expect(summary).toEqual(expected);
  });

  it.each(REFUSALS)('fails $name, going no further', async (refusal: IRefusal) => {
    const run = await runDiscount(refusal.fault, refusal.creds);
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(refusal.errorType);
    expect(run.result.errorMessage).toBe(refusal.message);
    expect(run.result.errorMessage).not.toContain(DC_BANK_NOTICE);
    expect(run.trail).toEqual(refusal.trail);
  });

  it.each(MALFORMED)('refuses %s before sending any request', async (_name, creds, message) => {
    const run = await runDiscount('none', creds);
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(GENERIC);
    expect(run.result.errorMessage).toBe(message);
    expect(run.calls).toHaveLength(0);
  });
});
