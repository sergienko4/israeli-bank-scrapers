/**
 * Beinleumi log oracle (AD-N12) — every value a run must never write to a log
 * line or a failure message: the credentials and every code a caller hands
 * in, the user and account names, each login id, token, cookie and bank text
 * the synthetic bank hands out, the envelope the run opened, and every opaque
 * device state the run was handed or published. Also the runs a log suite
 * drives, and what a BFF read may carry from the login.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { cookiesOf } from '../Helpers/MockReplies.js';
import type { BeinleumiFault } from './BeinleumiFaults.js';
import * as DATA from './BeinleumiMockData.js';
import { serverPoint } from './BeinleumiPeer.js';
import type { IBeinleumiRun, IRunSetup } from './BeinleumiRun.js';
import { WIRE_PATHS } from './BeinleumiWireSpec.js';

/** The wrong password, the wrong code, and a code of the wrong length a run is handed. */
const WRONG = { password: 'syn-Wrong-99', code: '13572468', shortCode: '9753186' } as const;

/** The user a stored state of another account is bound to. */
export const OTHER_UID = 'synother07';

/**
 * The name half of a cookie pair.
 * @param pair - A `name=value` cookie pair.
 * @returns The name.
 */
function cookieNameOf(pair: string): string {
  const [name] = pair.split('=');
  return name;
}

/**
 * The value half of a cookie pair.
 * @param pair - A `name=value` cookie pair.
 * @returns The value.
 */
function cookieValueOf(pair: string): string {
  const valueStart = pair.indexOf('=') + 1;
  return pair.slice(valueStart);
}

/** Every login value but the authorization, which the scrape must carry. */
export const LOGIN_SECRETS: readonly string[] = [
  ...Object.values(DATA.BEINLEUMI_MOCK_CREDS),
  DATA.BN_UID,
  OTHER_UID,
  ...Object.values(WRONG),
  DATA.BN_OTP,
  DATA.BN_TOKEN,
  DATA.BN_SSO_CODE,
  decodeURIComponent(DATA.BN_SSO_CODE),
  DATA.BN_DID,
  DATA.BN_STORED_DID,
  DATA.BN_SID,
  DATA.BN_FRESH_SID,
  DATA.BN_CRYPTO_SESSION,
  DATA.BN_CHALLENGE,
  DATA.BN_PWD_ASSERTION,
  DATA.BN_OTP_ASSERTION,
  DATA.BN_OTP_TARGET,
  DATA.BN_PHONE_MASK,
  DATA.BN_CLIENT_IP,
  DATA.BN_HANDOFF_RID,
  DATA.BN_BANK_NOTICE,
  serverPoint(),
];

/** The cookies the portal sets, as `name=value` pairs. */
export const PORTAL_COOKIES: readonly string[] = [DATA.BN_PORTAL_COOKIE, DATA.BN_LANDING_COOKIE];

/** The values a log must not name besides the login ones: the session, cookies, accounts. */
const SESSION_SECRETS: readonly string[] = [
  DATA.BN_AUTHORIZATION,
  DATA.BN_AUTHORIZATION.split(' ')[1],
  ...PORTAL_COOKIES.map(cookieValueOf),
  DATA.BN_ACCOUNT.account,
  DATA.BN_OTHER_ACCOUNT.account,
];

/**
 * The cookie names a call sent, sorted.
 * @param call - The call.
 * @returns Each name in its Cookie header.
 */
export function cookieNamesOf(call: IRecordedCall): readonly string[] {
  const pairs = cookiesOf(call);
  return pairs.map(cookieNameOf).sort();
}

/** The names of the cookies the portal sets, sorted: the only ones a BFF read may send. */
export const PORTAL_COOKIE_NAMES: readonly string[] = PORTAL_COOKIES.map(cookieNameOf).sort();

/**
 * The envelope values one run held: the client's point and the shared key.
 * @param run - The run.
 * @returns The point as sent, and the key as hex and base64.
 */
export function envelopeOf(run: IBeinleumiRun): readonly string[] {
  const exchange = run.calls.find(call => new URL(call.url).pathname === WIRE_PATHS.keyExchange);
  const sent = JSON.parse(exchange?.body ?? '{"headers":[]}') as { headers: { y?: string }[] };
  const point = sent.headers[1]?.y ?? '';
  const key = run.state.key;
  return [point, key.toString('hex'), key.toString('base64')].filter(value => value !== '');
}

/**
 * Every opaque device state a run was handed or published.
 * @param run - The run.
 * @returns The stored state, then each published one.
 */
export function statesOf(run: IBeinleumiRun): readonly string[] {
  const stored = run.stored === '' ? [] : [run.stored];
  return [...stored, ...run.published];
}

/**
 * Every value a text holds.
 * @param text - The text searched.
 * @param secrets - Values that must not appear.
 * @returns The ones that did.
 */
export function leakedIn(text: string, secrets: readonly string[]): readonly string[] {
  return secrets.filter(secret => text.includes(secret));
}

/** What a run leaked into its log lines and into its failure message. */
export interface ILeaks {
  readonly logged: readonly string[];
  readonly reported: readonly string[];
}

/**
 * The secrets a run leaked into its log lines and its failure message.
 * @param run - The run.
 * @param lines - The log lines it emitted.
 * @returns The leaked values, by where they leaked.
 */
export function leaksOf(run: IBeinleumiRun, lines: readonly string[]): ILeaks {
  const envelope = envelopeOf(run);
  const states = statesOf(run);
  const secrets = [...LOGIN_SECRETS, ...SESSION_SECRETS, ...envelope, ...states];
  const emitted = lines.join('');
  const logged = leakedIn(emitted, secrets);
  const reported = leakedIn(run.result.errorMessage ?? '', secrets);
  return { logged, reported };
}

/** One logged run: how the bank misbehaves, what the caller hands it, and its device states. */
export interface ILoggedRun {
  readonly label: string;
  readonly fault: BeinleumiFault;
  readonly setup: IRunSetup;
  /** The opaque device states the run is handed or publishes. */
  readonly states: number;
}

/** A resume: the stored device id, and a callback that records. */
export const RESUME = { storedDid: DATA.BN_STORED_DID, callback: 'record' } as const;

/** Every bank fault, run with default caller inputs. */
const FAULTS: readonly BeinleumiFault[] = [
  'none',
  'otpGenerate',
  'otpValidate',
  'otpSidRefresh',
  'otpVoiceOnly',
  'otpAlphaFormat',
  'locked',
  'expired',
  'plaintextAssert',
  'noPasswordEnc',
  'ambiguousHandoff',
  'postMessageHandoff',
  'crossOriginHandoff',
  'sso204',
];

/** The runs each bank fault drives. */
export const FAULT_RUNS: readonly ILoggedRun[] = FAULTS.map(fault => {
  return { label: fault, fault, setup: {}, states: 0 };
});

/** The runs each caller outcome drives: credentials, codes and device memory. */
export const OUTCOME_RUNS: readonly ILoggedRun[] = [
  {
    label: 'wrong password',
    fault: 'none',
    setup: { creds: { password: WRONG.password } },
    states: 0,
  },
  { label: 'wrong code', fault: 'otpGenerate', setup: { otp: WRONG.code }, states: 0 },
  {
    label: 'code of the wrong length',
    fault: 'otpGenerate',
    setup: { otp: WRONG.shortCode },
    states: 0,
  },
  { label: 'no retriever', fault: 'otpGenerate', setup: { otp: false }, states: 0 },
  { label: 'enroll', fault: 'none', setup: { callback: 'record' }, states: 1 },
  { label: 'resume', fault: 'otpGenerate', setup: RESUME, states: 1 },
  {
    label: 'state of another account',
    fault: 'none',
    setup: { ...RESUME, stateAccount: OTHER_UID },
    states: 1,
  },
  { label: 'callback rejects', fault: 'none', setup: { callback: 'reject' }, states: 1 },
];
