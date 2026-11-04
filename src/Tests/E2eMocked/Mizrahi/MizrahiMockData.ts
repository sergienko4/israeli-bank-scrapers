/**
 * Mizrahi synthetic wire data — the hosts, cookies, tokens, accounts and
 * rows the fetch mock serves and the mocked E2E suites assert.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import moment from 'moment';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';

/** Login origin (bootstrap + LoginUser). */
export const MZ_WEB = 'https://www.mizrahi-tefahot.co.il';

/** Authenticated origin (landing, logon, data). */
export const MZ_MTO = 'https://mto.mizrahi-tefahot.co.il';

/** Synthetic credentials for mock-mode runs — safe for public fixtures. */
export const MIZRAHI_MOCK_CREDS = Object.freeze({
  username: 'synthetic-mz-user',
  password: 'synthetic-mz-pass',
});

/** The XSRF-TOKEN cookie value as the bank sets it: URL-encoded. */
export const MZ_XSRF_RAW = 'syn%2Bmz%2Fxsrf';

/** The value LoginUser demands in X-XSRF-TOKEN: the cookie, URL-decoded. */
export const MZ_XSRF_DECODED = 'syn+mz/xsrf';

/** `body.xsrfToken` logon returns. */
export const MZ_LOGON_XSRF = 'syn-mz-logon-xsrf';

/** The `skyserid` response header logon returns. */
export const MZ_SKYSERID = 'syn-mz-sky-42';

/** The `mizrahixsrftoken` every data call must carry. */
export const MZ_DATA_TOKEN = `${MZ_LOGON_XSRF}###3${MZ_SKYSERID}`;

/** The token when logon answered without `skyserid`. */
export const MZ_DATA_TOKEN_NO_SKY = `${MZ_LOGON_XSRF}###3`;

/** Parent-domain pair www sets and both hosts receive. */
export const MZ_XSRF_COOKIE = `XSRF-TOKEN=${MZ_XSRF_RAW}`;

/** Host-only www pair, which must never reach mto. */
export const MZ_WEB_SESSION = 'ASP.NET_SessionId=syn-mz-web-sess';

/** Parent-domain pair a successful login sets. */
export const MZ_AUTH_COOKIE = 'MizrahiAuth=syn-mz-auth-5f1c';

/** Host-only mto pairs the landing hops set, one per hop. */
export const MZ_HOP_COOKIES: readonly string[] = ['SkyHop1=syn-mz-h1', 'SkyHop2=syn-mz-h2'];

/** Landing path every hop stays on. */
export const MZ_LANDING_PATH = '/Online/Default.aspx';

/** Landing URL the flow asks for. */
export const MZ_LANDING_URL = `${MZ_MTO}${MZ_LANDING_PATH}?language=he-IL`;

/** One synthetic account: number, balance and its movement amounts. */
export interface ISynAccount {
  readonly number: string;
  readonly balance: number;
  readonly amounts: readonly number[];
}

/** Two accounts, so the per-account switch and attribution are observable. */
export const MIZRAHI_MOCK_ACCOUNTS: readonly ISynAccount[] = [
  { number: '000-111111', balance: 1520.4, amounts: [-51, 129.9] },
  { number: '000-222222', balance: -310, amounts: [-20] },
];

/** Movements sit two days back so they are always inside the window. */
const MOVEMENT_DAY = moment().subtract(2, 'days').format('YYYY-MM-DD[T]00:00:00');

/** Opens the scrape window two months back, before every synthetic row. */
export const MIZRAHI_MOCK_START_DATE = moment().subtract(2, 'months').startOf('month').toDate();

/** The balance line get428Index puts first; it is not a movement. */
const BALANCE_LINE: JsonUnknownRecord = {
  RecTypeSpecified: false,
  MC02TnuaTeurEZ: 'SYNTHETIC balance line',
  MC02SchumEZ: 0,
};

/**
 * One synthetic movement row.
 * @param amount - Signed amount.
 * @param index - Row position, used in the row's reference.
 * @returns A get428Index-shaped movement row.
 */
function movementRow(amount: number, index: number): JsonUnknownRecord {
  const ordinal = String(index + 1);
  const dates = { MC02PeulaTaaEZ: MOVEMENT_DAY, MC02ErehTaaEZ: MOVEMENT_DAY };
  const text = { MC02TnuaTeurEZ: `SYNTHETIC Movement ${ordinal}`, MC02SchumEZ: amount };
  const ids = { MC02AsmahtaMekoritEZ: `9${ordinal}00`, TransactionNumber: '1' };
  return { RecType: 1, RecTypeSpecified: true, ...dates, ...text, ...ids };
}

/**
 * The rows get428Index serves for an account.
 * @param account - Account the rows belong to.
 * @returns The balance line, then one row per amount.
 */
export function rowsOf(account: ISynAccount): readonly JsonUnknownRecord[] {
  const movements = account.amounts.map(movementRow);
  return [BALANCE_LINE, ...movements];
}

/**
 * The logon `Accounts[]` entries.
 * @returns One entry per synthetic account.
 */
export function logonAccounts(): readonly JsonUnknownRecord[] {
  return MIZRAHI_MOCK_ACCOUNTS.map(account => ({ SnifAndNumber400: account.number }));
}
