/**
 * Telebank group sibling — mocked E2E for Mercantile, which logs in through
 * Discount's flow under its own brand: the login page's `?bank=m` query and
 * `merkantil` routing cookie, the bank code `m` in the key request and the
 * login, its two `Uid` prefixes and the Referers naming its login page.
 * Discount's suites cover the shared wire in full; this suite proves the
 * brand values and the outcomes a brand can change. Each value is a literal
 * copied from the protocol.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../Scrapers/Base/Interface.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { parseBody } from '../Helpers/FetchMockKit.js';
import { cookiesOf } from '../Helpers/MockReplies.js';
import { MERCANTILE_MOCK_BRAND } from './DiscountBrands.js';
import type { DiscountFault } from './DiscountFaults.js';
import { DC_LONG_ID, DISCOUNT_MOCK_ACCOUNTS, DISCOUNT_MOCK_CREDS } from './DiscountMockData.js';
import {
  callTo,
  COLD_TRAIL,
  type IDiscountRun,
  LOGIN_TRAIL,
  runDiscount,
  SUCCESS_HOP,
  trailOf,
} from './DiscountRun.js';

/** A run Mercantile refuses: the input, the failure it must surface, the calls it makes. */
interface IRefusal {
  readonly name: string;
  readonly fault: DiscountFault;
  readonly creds: ScraperCredentials;
  readonly errorType: ScraperErrorTypes;
  readonly message: string;
}

const PRIME = 'GET /login/?bank=m';
const LOGIN_PAGE = 'https://start.telebank.co.il/login/?bank=m';
const GET_INFO_BODY =
  '{"Application":"WEB","Caller":"Internet","Bank":"m","Lang":"he","CustType":"private","Source":1}';

const CREDS: ScraperCredentials = { ...DISCOUNT_MOCK_CREDS };
const BRAND_TRAIL = [PRIME, ...COLD_TRAIL.slice(1)];
const TO_OUTCOME = [PRIME, ...LOGIN_TRAIL.slice(1), SUCCESS_HOP];

/** The calls that name the login page as their Referer. */
const REFERRED = [
  LOGIN_TRAIL[1],
  LOGIN_TRAIL[2],
  SUCCESS_HOP,
  'GET /apollo/retail3',
  'GET /apollo/retail3/',
];

/** Refused logins and the failure each must surface. */
const REFUSALS: readonly IRefusal[] = [
  {
    name: 'a wrong password',
    fault: 'none',
    creds: { ...CREDS, password: 'synthetic-wrong-pass' },
    errorType: ScraperErrorTypes.InvalidPassword,
    message: 'logon answer statusRejected',
  },
  {
    name: 'a login bound to another id',
    fault: 'mi6Mismatch',
    creds: CREDS,
    errorType: ScraperErrorTypes.Generic,
    message: 'logon extract mi6 mismatch',
  },
];

/**
 * Scrape Mercantile against the synthetic bank.
 * @param fault - Fault the bank answers with.
 * @param creds - Credentials to scrape with.
 * @returns The run.
 */
function runMercantile(fault: DiscountFault, creds: ScraperCredentials): Promise<IDiscountRun> {
  return runDiscount(fault, creds, MERCANTILE_MOCK_BRAND);
}

/**
 * The login body a run sent.
 * @param run - The run.
 * @returns Its parsed fields.
 */
function loginBodyOf(run: IDiscountRun): Record<string, unknown> {
  const loginCall = callTo(run.calls, LOGIN_TRAIL[2]);
  return parseBody(loginCall.body);
}

/**
 * Whether a call is one that names the login page as its Referer.
 * @param call - A recorded call.
 * @returns True for the key request, the login, its hop and the landing.
 */
function isReferred(call: IRecordedCall): boolean {
  const step = trailOf(call);
  return REFERRED.includes(step);
}

describe('Mercantile browserless login (Telebank group)', () => {
  it('signs in cold through its own login page', async () => {
    const run = await runMercantile('none', CREDS);
    expect(run.result.success).toBe(true);
    expect(run.trail).toEqual(BRAND_TRAIL);
  });

  it('reports each account with its own balance and movements', async () => {
    const run = await runMercantile('none', CREDS);
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(account => [
      account.accountNumber,
      account.balance,
      account.txns.map(txn => txn.chargedAmount),
    ]);
    const expected = DISCOUNT_MOCK_ACCOUNTS.map(acct => [acct.display, acct.balance, acct.amounts]);
    expect(summary).toEqual(expected);
  });

  it("is refused at the login page when the run opens Discount's", async () => {
    const brand = { ...MERCANTILE_MOCK_BRAND, companyId: CompanyTypes.Discount };
    const run = await runDiscount('none', CREDS, brand);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('prime HTTP 404');
    expect(run.trail).toEqual(['GET /login/']);
  });

  it('asks for the key naming bank m, byte for byte', async () => {
    const run = await runMercantile('none', CREDS);
    const keyCall = callTo(run.calls, LOGIN_TRAIL[1]);
    expect(keyCall.body).toBe(GET_INFO_BODY);
  });

  it.each([
    ['an id of up to nine digits', DISCOUNT_MOCK_CREDS.id, '00011024681357'],
    ['a ten-digit id starting with 9', DC_LONG_ID, `0001${DC_LONG_ID}`],
  ])('logs in as bank m with %s under its prefix', async (_name, id, uid) => {
    const run = await runMercantile('none', { ...CREDS, id });
    const body = loginBodyOf(run);
    expect(run.result.success).toBe(true);
    expect([body.Bank, body.Uid]).toEqual(['m', uid]);
  });

  it('sends its routing cookie to the login page and names that page as Referer', async () => {
    const run = await runMercantile('none', CREDS);
    const primeCall = callTo(run.calls, PRIME);
    const referred = run.calls.filter(isReferred);
    const referers = referred.map(call => call.headers.get('referer'));
    const primeCookies = cookiesOf(primeCall);
    const expected = REFERRED.map(() => LOGIN_PAGE);
    expect(primeCookies).toContain('cssName=merkantil');
    expect(referers).toEqual(expected);
  });

  it.each(REFUSALS)('fails $name, going no further', async (refusal: IRefusal) => {
    const run = await runMercantile(refusal.fault, refusal.creds);
    expect(run.result.errorType).toBe(refusal.errorType);
    expect(run.result.errorMessage).toBe(refusal.message);
    expect(run.trail).toEqual(TO_OUTCOME);
  });

  it('refuses a malformed id before sending any request', async () => {
    const run = await runMercantile('none', { ...CREDS, id: '1123456789' });
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('derivedCarry: uid unformattable');
    expect(run.calls).toHaveLength(0);
  });
});
