/**
 * Yahav synthetic bank data — the user, the device the bank enrols, the
 * gateway and BaNCS session values it hands out, and the accounts it holds.
 * Session values carry a generation number so a stale echo is told apart.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';

export const YAHAV_MOCK_CREDS = {
  num: 'SYN0042',
  nationalID: '012345678',
  password: 'syn-Pass-7',
} as const;

/** The `num-nationalID` user name every login call names. */
export const YH_USER = `${YAHAV_MOCK_CREDS.num}-${YAHAV_MOCK_CREDS.nationalID}`;

/** The app client the bank issues at initialize. */
export const YH_CLIENT_ID = 'syn-client-7001';
export const YH_CLIENT_SECRET = 'syn-secret-7001';

/** The device handle the bank issues at register, echoed on every later call. */
export const YH_MAG = Buffer.from('SYN-mag-identifier-0001').toString('base64');

export const YH_ACCESS_TOKEN = 'syn-access-token-7001';

/** Gateway cookies (initialize, register) and the BaNCS cookie (login). */
export const YH_INIT_COOKIE = 'gw_init=SYN-init';
export const YH_REG_COOKIE = 'gw_reg=SYN-reg';
export const YH_BANCS_COOKIE = 'bancs_route=SYN-route';

/** The scrape window starts this many days ago: three month chunks. */
const WINDOW_DAYS = 60;

/** One synthetic account the portfolio holds. */
export interface IYahavMockAccount {
  readonly id: string;
  /** Bank account number; empty for an account the bank lists without one. */
  readonly number: string;
  readonly balance: string;
}

export const YH_ACCOUNTS: readonly IYahavMockAccount[] = [
  { id: 'SYN-acct-1', number: 'SYN-100200', balance: '1234.50' },
  { id: 'SYN-acct-2', number: '', balance: '-80.25' },
];

/** The default portfolio among the two the customer holds. */
export const YH_PORTFOLIO = { id: 'SYN-pf-2', iorId: 'SYN-pf-ior-2' } as const;

/** Each account's movements, as days before today and amount text. */
export const YH_TXN_DAYS = [3, 35] as const;
export const YH_TXN_AMOUNTS = ['-12.50', '300.00'] as const;

/** One generation of BaNCS session state. */
export interface IBancsState {
  readonly session: string;
  readonly xsrf: string;
  readonly csrf: string;
  readonly security: JsonUnknownRecord;
}

/**
 * The BaNCS session state the bank hands out at a generation.
 * @param generation - How many BaNCS answers came before (1 = login).
 * @returns Session id, XSRF and CSRF texts, and the security token.
 */
export function bancsStateAt(generation: number): IBancsState {
  const tag = String(generation);
  const token = [{ Ver: 'Token_1.0.0', TknVal: `SYN-sec-${tag}` }];
  const security = { Ver: 'SecurityToken_1.0.0', isArchetype: false, Token: token };
  return {
    session: `SYN-session-${tag}`,
    xsrf: `SYN-xsrf-${tag}`,
    csrf: `SYN-csrf-${tag}`,
    security,
  };
}

/**
 * Midnight UTC a number of days before today.
 * @param days - Days back.
 * @returns The day.
 */
export function daysAgo(days: number): Date {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const date = today.getUTCDate();
  const midnight = Date.UTC(year, month, date);
  return new Date(midnight - days * 86_400_000);
}

/** Where the scrape window starts. */
export const YAHAV_MOCK_START_DATE = daysAgo(WINDOW_DAYS);

export { YAHAV_NATIVE_ORIGIN as YH_ORIGIN } from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigYahavConstants.js';
