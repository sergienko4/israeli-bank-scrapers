/**
 * Hapoalim synthetic data — credentials, app constants, cookies, accounts and
 * movements the mocked bank serves. The mock speaks the app edge only.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import moment from 'moment';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';

/** The bank's app origin: login, device registration and data. */
export const HP_ORIGIN = 'https://iphone.bankhapoalim.co.il';

/** App id every app call carries. */
export const HP_APP_ID = 'bankApp3Generation';

/** App version the calls advertise. */
export const HP_APP_VERSION = '44.3.0';

/** Synthetic RiskMinder signature; valid JSON with a synthetic Android id. */
export const HP_DEVICE_SIGNATURE = JSON.stringify({
  deviceSignature: { system: { androidId: 'syn-hp-android-id' } },
  ipAddress: '203.0.113.7',
});

/** The server-issued device id verify reports. */
export const HP_DEVICE_ID = 'syn-hp-kdi-41c2';

/** The code the synthetic login SMS carries. */
export const HP_OTP = '24680';

/** The code the synthetic device step-up SMS carries; distinct from the login code. */
export const HP_STEPUP_OTP = '97531';

/** The masked phone otp init reports, passed to the retriever as its hint. */
export const HP_PHONE = 'SYN-***-4321';

/** Synthetic credentials. */
export const HAPOALIM_MOCK_CREDS = Object.freeze({
  userCode: 'syn-hp-user',
  password: 'syn-Pass!7',
  deviceSignature: HP_DEVICE_SIGNATURE,
});

/** The organization code the app calls carry. */
export const HP_ORGANIZATION = '106402333';

/** XSRF cookie as set (percent-encoded) and as the header must echo it. */
export const HP_XSRF_RAW = 'syn%2Bhp%2Fxsrf';
export const HP_XSRF_DECODED = 'syn+hp/xsrf';

/** The CSRF cookie verify sets, and the decoded `csrffield` otp verify posts. */
export const HP_CSRF_RAW = 'syn%2Bhp%2Fcsrf';
export const HP_CSRF_DECODED = 'syn+hp/csrf';

/** Cookie pairs the bank sets. */
export const HP_XSRF_COOKIE = `XSRF-TOKEN=${HP_XSRF_RAW}`;
export const HP_CSRF_COOKIE = `csrfcookie=${HP_CSRF_RAW}`;
export const HP_AUTH_COOKIE = 'SMSESSION=syn-hp-auth-7d2e';

/** The device registration cookie `step1-mobile` sets. */
export const HP_STEP1_COOKIE = 'lbmobilerestprd=syn-hp-1';

/** The session the bank opens once a stored one has expired. */
export const HP_FRESH_AUTH_COOKIE = 'SMSESSION=syn-hp-auth-9c41';

/** The cookie the bank sets when it refuses a session. */
export const HP_REFUSED_COOKIE = 'SYN-REFUSED=syn-hp-refused-5b';

/** One synthetic account and what the bank holds for it. */
export interface ISynAccount {
  readonly accountNumber: number;
  readonly closingCode: number;
  readonly balance: number;
  readonly amounts: readonly number[];
}

/** Two open accounts and a closed one, which the scrape must skip. */
export const HAPOALIM_MOCK_ACCOUNTS: readonly ISynAccount[] = [
  { accountNumber: 111111, closingCode: 0, balance: 1520.4, amounts: [-51, 129.9] },
  { accountNumber: 222222, closingCode: 0, balance: -310, amounts: [-20] },
  { accountNumber: 333333, closingCode: 5, balance: 0, amounts: [] },
];

/** The open accounts, in order. */
export const HAPOALIM_OPEN_ACCOUNTS = HAPOALIM_MOCK_ACCOUNTS.filter(acct => acct.closingCode === 0);

/** Bank and branch every synthetic account sits under. */
const BANK = 12;
const BRANCH = 600;

/** Where the scrape window starts. */
export const HAPOALIM_MOCK_START_DATE = moment().subtract(2, 'months').startOf('month').toDate();

/** The day every movement is booked on, as the bank's `YYYYMMDD` number. */
const MOVEMENT_DAY_TEXT = moment().subtract(2, 'days').format('YYYYMMDD');
const MOVEMENT_DAY = Number(MOVEMENT_DAY_TEXT);

/**
 * The account id the bank composes and the scrape sends back.
 * @param acct - A synthetic account.
 * @returns `bank-branch-number`.
 */
export function compositeOf(acct: ISynAccount): string {
  return `${String(BANK)}-${String(BRANCH)}-${String(acct.accountNumber)}`;
}

/**
 * The accounts list the bank serves.
 * @returns One raw account per synthetic account, closed ones included.
 */
export function accountsBody(): readonly JsonUnknownRecord[] {
  return HAPOALIM_MOCK_ACCOUNTS.map(acct => ({
    bankNumber: BANK,
    branchNumber: BRANCH,
    accountNumber: acct.accountNumber,
    accountClosingReasonCode: acct.closingCode,
  }));
}

/**
 * One movement row; the sign rides on the activity type, the amount is bare.
 * @param amount - Signed synthetic amount.
 * @param index - Row index.
 * @returns The raw row.
 */
function movementRow(amount: number, index: number): JsonUnknownRecord {
  const ordinal = String(index + 1);
  const typeCode = amount < 0 ? 2 : 1;
  const text = {
    activityDescription: `SYNTHETIC Movement ${ordinal}`,
    referenceNumber: 9100 + index,
  };
  const dates = { eventDate: MOVEMENT_DAY, valueDate: MOVEMENT_DAY };
  return { ...dates, ...text, eventAmount: Math.abs(amount), eventActivityTypeCode: typeCode };
}

/**
 * An account's movement rows.
 * @param acct - A synthetic account.
 * @returns Its raw rows.
 */
export function rowsOf(acct: ISynAccount): readonly JsonUnknownRecord[] {
  return acct.amounts.map(movementRow);
}

/**
 * The synthetic account a composite id names.
 * @param composite - `bank-branch-number` from the request query.
 * @returns The account, or false for an unknown id.
 */
export function accountOf(composite: string): ISynAccount | false {
  const found = HAPOALIM_MOCK_ACCOUNTS.find(acct => compositeOf(acct) === composite);
  return found ?? false;
}
