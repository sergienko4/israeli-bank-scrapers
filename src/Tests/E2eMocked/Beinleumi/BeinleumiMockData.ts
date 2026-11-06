/**
 * Beinleumi synthetic bank data — the user, the values the login page
 * names, the Transmit ids and tokens the bank hands out, the portal hand-off
 * it answers, and the account it holds.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import moment from 'moment';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';

export const BEINLEUMI_MOCK_CREDS = { username: 'SynUser042', password: 'syn-Pass-31' } as const;

/** The lower-cased user name every sealed call names as `uid`. */
export const BN_UID = 'synuser042';

/** The client address the login page assigns in its script. */
export const BN_CLIENT_IP = '192.0.2.31';

/** The portal session cookie the login page sets; the logon post must echo it. */
export const BN_PORTAL_COOKIE = 'JSESSIONID=SYN-portal-0031';

/** The envelope session the key exchange opens. */
export const BN_CRYPTO_SESSION = 'syn-crypto-session-0031';

/** The device id the bank issues, and one a caller stored from an earlier run. */
export const BN_DID = 'syn-did-issued-0031';
export const BN_STORED_DID = 'syn-did-stored-0042';

/** The session id the login answer issues, and the one a refresh replaces it with. */
export const BN_SID = 'syn-sid-0001';
export const BN_FRESH_SID = 'syn-sid-0002';

/** The challenge and assertion ids the bank hands out. */
export const BN_CHALLENGE = 'syn-challenge-0031';
export const BN_PWD_ASSERTION = 'syn-pwd-assertion-01';
export const BN_OTP_ASSERTION = 'syn-otp-assertion-01';
export const BN_OTP_TARGET = 'syn-target-01';
export const BN_PHONE_MASK = '05X-XXX-0031';

/** The code the bank sends: the offer names six digits, the SMS trigger eight. */
export const BN_OFFERED_OTP_LENGTH = 6;
export const BN_OTP_LENGTH = 8;
export const BN_OTP = '24681357';

/** The Transmit token a completed assertion hands out. */
export const BN_TOKEN = 'syn-transmit-token-0031';

/** The portal pages the hand-off script and its one redirect name. */
export const BN_HANDOFF_PATH = '/wps/portal/FibiMenu/home';
export const BN_HANDOFF_RID = 'syn-rid-01';
export const BN_LANDING_PATH = '/wps/myportal/FibiMenu/Online/syn-landing';

/** The portal session cookie the redirect to the landing sets; the SSO calls must echo it. */
export const BN_LANDING_COOKIE = 'LtpaToken2=SYN-ltpa-0031';

/** The SSO code the bootstrap answer carries, and the authorization it buys. */
export const BN_SSO_CODE = 'SYN-sso-code%2B01';
export const BN_AUTHORIZATION = 'SynToken syn-authz-0031';

/** Bank text an error answer carries; it must never reach a log line. */
export const BN_BANK_NOTICE = 'SYN bank notice 0031';

/** The scrape window: two whole months back. */
export const BEINLEUMI_MOCK_START_DATE = moment().subtract(2, 'months').startOf('month').toDate();

/** The account the user selected, and one the portal lists but did not select. */
export const BN_ACCOUNT = { account: '555001', branch: '770', selected: true } as const;
export const BN_OTHER_ACCOUNT = { account: '555002', branch: '770', selected: false } as const;
export const BN_ACCOUNT_TYPE = 105;
export const BN_BALANCE = 1234.5;

/**
 * A synthetic movements row.
 * @param daysAgo - How many days before today the row was registered.
 * @param description - Its description.
 * @param amounts - Its credit and debit amounts.
 * @returns The row as the list call answers it.
 */
function txnRow(
  daysAgo: number,
  description: string,
  amounts: Readonly<{ credit: number; debit: number }>,
): JsonUnknownRecord {
  const day = moment().subtract(daysAgo, 'days').format('YYYY-MM-DD');
  const stamp = `${day}T00:00:00`;
  const registered = { dateOfRegistration: stamp, dateOfBusinessDay: stamp, description };
  return { ...registered, creditAmount: amounts.credit, debitAmount: amounts.debit };
}

/** The movements the account holds, newest first, inside the window. */
export const BN_TXNS: readonly JsonUnknownRecord[] = [
  txnRow(3, 'SYN-PAYMENT-A', { credit: 0, debit: 120.5 }),
  txnRow(20, 'SYN-CREDIT-B', { credit: 300, debit: 0 }),
];
