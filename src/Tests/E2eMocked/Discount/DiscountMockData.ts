/**
 * Discount synthetic wire data — the origin, cookies, key, accounts and rows
 * the fetch mock serves and the mocked E2E suites assert.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { createHash } from 'node:crypto';

import moment from 'moment';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import { makePkcs1Key } from '../../Helpers/SealOpener.js';

/** The one origin every Discount call goes to. */
export const DC_ORIGIN = 'https://start.telebank.co.il';

/** The login page: the prime call's URL and the login calls' Referer. */
export const DC_LOGIN_PAGE = `${DC_ORIGIN}/login/`;

/** The retail page: the landing hop's target and the Titan calls' Referer. */
export const DC_RETAIL_PAGE = `${DC_ORIGIN}/apollo/retail3/`;

/** Where a successful login redirects. */
export const DC_HANDOFF_PATH = '/Lobby/gatewayAPI/loginSuccessResponse';

/** Synthetic credentials for mock-mode runs — safe for public fixtures. */
export const DISCOUNT_MOCK_CREDS = Object.freeze({
  id: '24681357',
  password: 'synthetic-dc-pass',
  num: 'syn-dc-num',
});

/** The `Uid` an 8-digit id formats to: `00001`, then the id padded to 9. */
export const DC_UID = '00001024681357';

/**
 * The md5-hex of a text, as the bank binds a login to its `Uid`.
 * @param text - The text to hash.
 * @returns Lower-case hex.
 */
export function md5Of(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

/** The MI6 binding a successful login answers with. */
export const DC_MI6 = md5Of(DC_UID);

/** The synthetic RSA key getInfo hands out; the mock opens the seals with it. */
export const DC_KEY = makePkcs1Key();

/** The XSRF-TOKEN cookie the login page sets: URL-encoded. */
export const DC_XSRF_RAW = 'syn%2Bdc%2Fx1';

/** The value the next call must send in X-XSRF-TOKEN: the cookie, decoded. */
export const DC_XSRF_DECODED = 'syn+dc/x1';

/** The XSRF-TOKEN getInfo rotates to. */
export const DC_XSRF_ROTATED_RAW = 'syn%2Bdc%2Fx2';

/** The rotated token, decoded. */
export const DC_XSRF_ROTATED = 'syn+dc/x2';

/** An XSRF-TOKEN cookie no decoder accepts. */
export const DC_XSRF_MALFORMED = 'syn%ZZdc';

/** The `tuuid` cookie the login page sets; calls echo it as `uuid`. */
export const DC_TUUID = 'syn-dc-tuuid-7';

/** The session pair a successful login sets. */
export const DC_SESSION_COOKIE = 'DcSession=syn-dc-sess-3a';

/** The client cookies the prime step sets before its request. */
export const DC_PRIME_COOKIES: readonly string[] = [
  'cssName=discount',
  'language=HEBREW',
  't=P',
  'caller=internet',
];

/** The client cookies the landing step sets before its request. */
export const DC_LANDING_COOKIES: readonly string[] = [`mi6=${DC_MI6}`, 'fte=true', 'newRetail=1'];

/** One synthetic account: Titan id, display number, balance, movement amounts. */
export interface ISynAccount {
  readonly id: string;
  readonly display: string;
  readonly balance: number;
  readonly amounts: readonly number[];
}

/** Two accounts, so the per-account `AccountNumber` header is observable. */
export const DISCOUNT_MOCK_ACCOUNTS: readonly ISynAccount[] = [
  { id: 'SYN-DC-0001', display: '0-000-111111', balance: 1520.4, amounts: [-51, 129.9] },
  { id: 'SYN-DC-0002', display: '0-000-222222', balance: -310, amounts: [-20] },
];

/** Noon UTC two months back: the same calendar day in Israel all year. */
const START = moment.utc().subtract(2, 'months').startOf('month').hour(12);

/** Opens the scrape window before every synthetic row. */
export const DISCOUNT_MOCK_START_DATE = START.toDate();

/** The `FromDate` every transactions call must ask for. */
export const DC_FROM_DATE = START.format('YYYYMMDD');

/** Movements sit two days back so they are always inside the window. */
const MOVEMENT_DAY = moment().subtract(2, 'days').format('YYYYMMDD');

/**
 * One synthetic movement row.
 * @param amount - Signed amount.
 * @param index - Row position, used in the row's text and number.
 * @returns An `OperationEntry` row.
 */
function movementRow(amount: number, index: number): JsonUnknownRecord {
  const ordinal = String(index + 1);
  const dates = { OperationDate: MOVEMENT_DAY, ValueDate: MOVEMENT_DAY };
  const text = { OperationDescriptionToDisplay: `SYNTHETIC Movement ${ordinal}` };
  return { ...dates, ...text, OperationAmount: amount, OperationNumber: Number(`9${ordinal}00`) };
}

/**
 * The rows the transactions call serves for an account.
 * @param account - Account the rows belong to.
 * @returns One row per amount.
 */
export function rowsOf(account: ISynAccount): readonly JsonUnknownRecord[] {
  return account.amounts.map(movementRow);
}

/**
 * The `UserAccounts[]` entries the accounts call serves.
 * @returns One entry per synthetic account.
 */
export function userAccounts(): readonly JsonUnknownRecord[] {
  return DISCOUNT_MOCK_ACCOUNTS.map(account => ({
    NewAccountInfo: { AccountID: account.id },
    FormatAccountID: account.display,
  }));
}
