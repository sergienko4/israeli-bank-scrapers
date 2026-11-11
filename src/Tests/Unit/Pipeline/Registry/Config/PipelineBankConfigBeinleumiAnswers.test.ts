/**
 * Beinleumi api-direct login config — how each answer is read.
 * The login answer must offer exactly the password method, the password
 * answer either completes with a token or offers one SMS OTP target, and the
 * OTP calls must keep the code's stated length; anything else fails closed.
 * The rules on the captured page context, the SSO code and the authorization
 * header, and on the device and session ids, refuse anything the next call
 * could not send safely.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { checkRequiredCreds } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RequiredCreds.js';
import { classifyAnswer } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.classify.js';
import {
  CARRY,
  type CarrySlots,
  classified,
  CREDS,
  type IAnswerRead,
  isAccepted,
  loadModule,
  stepNamed,
  withoutSlot,
} from './BeinleumiConfigTestHelpers.js';

type Json = Record<string, JsonValue>;

const PASSWORD_METHOD = {
  type: 'password',
  locked: false,
  expired: false,
  assertion_id: CARRY.pwdAssertionId,
};
const SMS = {
  type: 'sms',
  assertion_id: CARRY.otpAssertionId,
  targets: { [CARRY.otpTargetId]: '05X-XXX-1234' },
};
const EMAIL = { type: 'email', assertion_id: 'syn-mail', targets: { m: 'a***@b' } };
const OTP_METHOD = {
  type: 'otp',
  locked: false,
  expired: false,
  state: 'generate',
  channels: [SMS],
  format: { type: 'numeric', length: 6 },
};
const UNFORMATTED_OTP = withoutSlot(OTP_METHOD, 'format');
const DONE = { data: { state: 'completed', assertions_complete: true, token: CARRY.token } };
const OTP_SLOTS = { otpAssertionId: CARRY.otpAssertionId, otpTargetId: CARRY.otpTargetId };

/**
 * A pending answer offering exactly one method.
 * @param method - The offered method.
 * @returns The opened answer.
 */
function offering(method: Json): JsonValue {
  const flow = [{ type: 'authentication', methods: [method] }];
  return { data: { state: 'pending', challenge: CARRY.challenge, control_flow: flow } };
}

/**
 * An answer offering the OTP method, changed.
 * @param change - Fields over the SMS-generate method.
 * @returns The opened answer.
 */
function otpOffer(change: Json): JsonValue {
  return offering({ ...OTP_METHOD, ...change });
}

/**
 * An answer naming a header of the given type.
 * @param type - Header type.
 * @param value - Its id.
 * @returns The opened answer.
 */
function headed(type: 'device_id' | 'session_id', value: string): JsonValue {
  return {
    headers: [
      { type: 'flow_id', flow_id: CARRY.flowId },
      { type, [type]: value },
    ],
  };
}

/**
 * Classify an answer the way the named step does.
 * @param name - Step name.
 * @param answer - Opened answer.
 * @returns The written slots, or the refusal's message.
 */
async function classifiedBy(name: string, answer: JsonValue): Promise<CarrySlots | string> {
  const { call } = await loadModule();
  const step = stepNamed(call, name);
  return classified(step, answer);
}

/**
 * Whether the named step's rules accept what it read.
 * @param name - Step name.
 * @param read - The slots as read, and the answer.
 * @returns True when every rule passes.
 */
async function acceptedBy(name: string, read: IAnswerRead): Promise<boolean> {
  const { call } = await loadModule();
  const step = stepNamed(call, name);
  return isAccepted(step, call, read);
}

/** A synthetic SSO authorization, inner space and all. */
const SYN_AUTHORIZATION = ['Bearer', 'syn-jwt'].join(' ');

/** One slot-rule row: the step, what it read, and whether its rules pass. */
interface ISlotCase {
  readonly name: string;
  readonly label: string;
  readonly carry: CarrySlots;
  readonly isOk: boolean;
}

const PRIME_SLOTS = { bankNum: '031', client_ip: '192.0.2.7' };

const LOGIN_CASES: readonly (readonly [string, JsonValue, Json | string])[] = [
  [
    'the password method',
    offering(PASSWORD_METHOD),
    { pwdAssertionId: CARRY.pwdAssertionId, challenge: CARRY.challenge, loginBranch: 'password' },
  ],
  ['a locked password', offering({ ...PASSWORD_METHOD, locked: true }), 'login answer locked'],
  ['an expired password', offering({ ...PASSWORD_METHOD, expired: true }), 'login answer expired'],
  [
    'a locked, expired password',
    offering({ ...PASSWORD_METHOD, locked: true, expired: true }),
    'login answer locked',
  ],
  ['the OTP method', offering(OTP_METHOD), 'login answer unrecognized'],
  ['no challenge', { data: { state: 'pending' } }, 'login answer unrecognized'],
  [
    'two methods',
    {
      data: {
        state: 'pending',
        challenge: 'c',
        control_flow: [{ type: 'authentication', methods: [PASSWORD_METHOD, OTP_METHOD] }],
      },
    },
    'login answer unrecognized',
  ],
];

const AUTH_CASES: readonly (readonly [string, JsonValue, Json | string])[] = [
  ['a completed login with a token', DONE, { authBranch: 'done' }],
  [
    'an SMS code to generate, of 6 digits',
    otpOffer({}),
    { ...OTP_SLOTS, otpLength: '6', authBranch: 'otp-generate' },
  ],
  [
    'an SMS code already sent, its format under otp_format',
    offering({ ...UNFORMATTED_OTP, state: 'validate', otp_format: { type: 'numeric', length: 4 } }),
    { ...OTP_SLOTS, otpLength: '4', authBranch: 'otp-validate' },
  ],
  [
    'format over otp_format, read whole',
    otpOffer({ otp_format: { type: 'numeric', length: 4 } }),
    { ...OTP_SLOTS, otpLength: '6', authBranch: 'otp-generate' },
  ],
  [
    'a format without a type, beside a numeric otp_format',
    otpOffer({ format: { length: 6 }, otp_format: { type: 'numeric', length: 4 } }),
    'assertPassword answer unrecognized',
  ],
  [
    'a format without a length, beside a numeric otp_format',
    otpOffer({ format: { type: 'numeric' }, otp_format: { type: 'numeric', length: 4 } }),
    'assertPassword answer unrecognized',
  ],
  [
    'an SMS code of no stated format',
    offering(UNFORMATTED_OTP),
    { ...OTP_SLOTS, authBranch: 'otp-generate' },
  ],
  [
    'SMS after an e-mail channel',
    otpOffer({ channels: [EMAIL, SMS] }),
    'assertPassword answer unrecognized',
  ],
  [
    'a code of 3 digits',
    otpOffer({ format: { type: 'numeric', length: 3 } }),
    'assertPassword answer unrecognized',
  ],
  [
    'a code of letters',
    otpOffer({ format: { type: 'alphanumeric', length: 6 } }),
    'assertPassword answer unrecognized',
  ],
  [
    'two SMS targets',
    otpOffer({ channels: [{ ...SMS, targets: { a: '1', b: '2' } }] }),
    'assertPassword answer unrecognized',
  ],
  ['e-mail only', otpOffer({ channels: [EMAIL] }), 'assertPassword answer unrecognized'],
  ['a locked OTP', otpOffer({ locked: true }), 'assertPassword answer unrecognized'],
  [
    'a QR code method',
    offering({ ...OTP_METHOD, type: 'qrcode' }),
    'assertPassword answer unrecognized',
  ],
  [
    'completion without the assertions',
    { data: { ...DONE.data, assertions_complete: false } },
    'assertPassword answer unrecognized',
  ],
  [
    'a token with a space',
    { data: { ...DONE.data, token: 'syn token' } },
    'assertPassword answer unrecognized',
  ],
];

const TRIGGER_CASES: readonly (readonly [string, JsonValue, Json | string])[] = [
  ['a code sent, format unchanged', { data: { state: 'pending' } }, { otpTrigger: 'pending' }],
  [
    'a code sent, of 5 digits now',
    { data: { state: 'pending', data: { otp_format: { type: 'numeric', length: 5 } } } },
    { otpLength: '5', otpTrigger: 'pending' },
  ],
  [
    'a code of letters now',
    { data: { state: 'pending', data: { otp_format: { type: 'alphanumeric', length: 5 } } } },
    'otpInit answer unrecognized',
  ],
  ['a completed login', DONE, 'otpInit answer unrecognized'],
];

const RESULT_CASES: readonly (readonly [string, JsonValue, Json | string])[] = [
  ['a completed login with a token', DONE, { otpResult: 'done' }],
  ['a pending login', { data: { state: 'pending' } }, 'assertOtp answer unrecognized'],
];

describe('Beinleumi api-direct login config — answers', () => {
  it.each(LOGIN_CASES)('login reads %s', async (_label, answer, expected) => {
    const verdict = await classifiedBy('login', answer);
    expect(verdict).toEqual(expected);
  });

  it.each(AUTH_CASES)('assertPassword reads %s', async (_label, answer, expected) => {
    const verdict = await classifiedBy('assertPassword', answer);
    expect(verdict).toEqual(expected);
  });

  it.each(TRIGGER_CASES)('otpInit reads %s', async (_label, answer, expected) => {
    const verdict = await classifiedBy('otpInit', answer);
    expect(verdict).toEqual(expected);
  });

  it.each(RESULT_CASES)('assertOtp reads %s', async (_label, answer, expected) => {
    const verdict = await classifiedBy('assertOtp', answer);
    expect(verdict).toEqual(expected);
  });

  it.each([
    [{ ...PASSWORD_METHOD, locked: true }, ScraperErrorTypes.AccountBlocked],
    [{ ...PASSWORD_METHOD, expired: true }, ScraperErrorTypes.ChangePassword],
  ] as const)('login stops a refused password as %#', async (method, errorType) => {
    const { call } = await loadModule();
    const step = stepNamed(call, 'login');
    const answer = offering(method);
    const verdict = classifyAnswer(step, answer);
    expect(verdict).toMatchObject({ success: false, errorType });
  });

  it('keeps the token the password or the code answer returned', async () => {
    const { call } = await loadModule();
    const token = { pointer: '/data/token' };
    expect(stepNamed(call, 'assertPassword').optionalExtractsToCarry).toMatchObject({ token });
    expect(stepNamed(call, 'assertOtp').extractsToCarry).toMatchObject({ token: '/data/token' });
  });

  it.each(['encryptionKey', 'login', 'assertPassword', 'otpInit', 'assertOtp'])(
    '%s keeps a known device, taking a newer session id',
    async name => {
      const { call } = await loadModule();
      const step = stepNamed(call, name);
      const optional = step.optionalExtractsToCarry;
      expect(optional).toMatchObject({
        did: { pointer: '/headers/?type=device_id/device_id', keepExisting: true },
      });
      expect(optional?.sid ?? step.extractsToCarry.sid).toBeDefined();
    },
  );
});

describe('Beinleumi api-direct login config — slot rules', () => {
  it.each<ISlotCase>([
    { name: 'prime', label: 'the bank number, an IPv4 client', carry: PRIME_SLOTS, isOk: true },
    {
      name: 'prime',
      label: 'another bank number',
      carry: { ...PRIME_SLOTS, bankNum: '046' },
      isOk: false,
    },
    {
      name: 'prime',
      label: 'an IPv6 client',
      carry: { ...PRIME_SLOTS, client_ip: '2001:db8::1' },
      isOk: true,
    },
    {
      name: 'prime',
      label: 'a client with markup',
      carry: { ...PRIME_SLOTS, client_ip: '192.0.2.7<' },
      isOk: false,
    },
    {
      name: 'prime',
      label: 'a one-letter client',
      carry: { ...PRIME_SLOTS, client_ip: 'x' },
      isOk: false,
    },
    { name: 'bootstrap', label: 'an SSO code', carry: { ssoCode: CARRY.ssoCode }, isOk: true },
    { name: 'bootstrap', label: 'a code with a fragment', carry: { ssoCode: 'a#b' }, isOk: false },
    { name: 'bootstrap', label: 'a code with a space', carry: { ssoCode: 'a b' }, isOk: false },
    { name: 'bootstrap', label: 'a code with a quote', carry: { ssoCode: 'a"b' }, isOk: false },
    {
      name: 'bootstrap',
      label: 'an over-long code',
      carry: { ssoCode: 'c'.repeat(32769) },
      isOk: false,
    },
    {
      name: 'sessionToken',
      label: 'an authorization',
      carry: { authorization: SYN_AUTHORIZATION },
      isOk: true,
    },
    {
      name: 'sessionToken',
      label: 'a padded authorization',
      carry: { authorization: ` ${SYN_AUTHORIZATION}` },
      isOk: false,
    },
    {
      name: 'sessionToken',
      label: 'a split authorization',
      carry: { authorization: 'Bearer\nsyn' },
      isOk: false,
    },
    {
      name: 'sessionToken',
      label: 'an over-long authorization',
      carry: { authorization: 'a'.repeat(32769) },
      isOk: false,
    },
    { name: 'login', label: 'a session id', carry: { sid: CARRY.sid }, isOk: true },
    { name: 'login', label: 'a session id with a space', carry: { sid: 'syn sid' }, isOk: false },
  ])('$name: $label → accepted=$isOk', async ({ name, carry, isOk }) => {
    const isPassed = await acceptedBy(name, { carry });
    expect(isPassed).toBe(isOk);
  });

  it.each([
    { type: 'device_id', slot: 'did', label: 'named', value: CARRY.did, isOk: true },
    { type: 'device_id', slot: 'did', label: 'spaced', value: 'syn did', isOk: false },
    { type: 'device_id', slot: 'did', label: 'over-long', value: 'd'.repeat(257), isOk: false },
    { type: 'session_id', slot: 'sid', label: 'named', value: CARRY.sid, isOk: true },
    { type: 'session_id', slot: 'sid', label: 'non-ASCII', value: 'syn\u00e9sid', isOk: false },
  ] as const)('assertPassword: a $type ($label) → accepted=$isOk', async row => {
    const resp = headed(row.type, row.value);
    const isPassed = await acceptedBy('assertPassword', { carry: { [row.slot]: row.value }, resp });
    expect(isPassed).toBe(row.isOk);
  });

  it('leaves a device it kept unchecked', async () => {
    const resp = headed('device_id', 'syn did');
    const read = { carry: { sid: CARRY.sid }, priorCarry: { did: CARRY.did }, resp };
    const isPassed = await acceptedBy('login', read);
    expect(isPassed).toBe(true);
  });
});

describe('Beinleumi api-direct login config — credentials', () => {
  it('needs a user name and a password, before any request', async () => {
    const { call } = await loadModule();
    const sound = checkRequiredCreds(call, CREDS);
    const blank = checkRequiredCreds(call, { ...CREDS, username: ' ' });
    expect(sound.success).toBe(true);
    expect(blank).toMatchObject({
      success: false,
      errorMessage: 'Missing or malformed credentials: username',
    });
  });
});
