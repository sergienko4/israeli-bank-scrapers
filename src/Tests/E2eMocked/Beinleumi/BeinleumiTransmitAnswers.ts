/**
 * Beinleumi mocked bank — the records the Transmit login and assertion calls
 * answer, before they are sealed: the password offer (or a locked / expired
 * one), the SMS offer each OTP fault names, the trigger and the completion.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { BeinleumiFault, OtpFault } from './BeinleumiFaults.js';
import {
  BN_BANK_NOTICE,
  BN_CHALLENGE,
  BN_OFFERED_OTP_LENGTH,
  BN_OTP_ASSERTION,
  BN_OTP_LENGTH,
  BN_OTP_TARGET,
  BN_PHONE_MASK,
  BN_PWD_ASSERTION,
  BN_TOKEN,
} from './BeinleumiMockData.js';

const PASSWORD_METHOD = {
  type: 'password',
  assertion_id: BN_PWD_ASSERTION,
  locked: false,
  expired: false,
};

/** The login answer's method for each login fault; the password offer otherwise. */
const LOGIN_METHODS: Readonly<Partial<Record<BeinleumiFault, JsonUnknownRecord>>> = {
  locked: { ...PASSWORD_METHOD, locked: true },
  expired: { ...PASSWORD_METHOD, expired: true },
};

const SMS_CHANNEL = {
  type: 'sms',
  assertion_id: BN_OTP_ASSERTION,
  targets: { [BN_OTP_TARGET]: BN_PHONE_MASK },
};

const VOICE_CHANNEL = { ...SMS_CHANNEL, type: 'voice' };

const OTP_METHOD = { type: 'otp', locked: false, expired: false, channels: [SMS_CHANNEL] };

const OFFERED_FORMAT = { type: 'numeric', length: BN_OFFERED_OTP_LENGTH };

/** A code the bank must send first; the offer names six digits. */
const GENERATE = { ...OTP_METHOD, state: 'generate', format: OFFERED_FORMAT };

/** A code already sent; its format sits under `otp_format`. */
const VALIDATE = {
  ...OTP_METHOD,
  state: 'validate',
  otp_format: { type: 'numeric', length: BN_OTP_LENGTH },
};

/** The assertPassword answer's offer for each OTP fault. */
const OTP_OFFERS: Readonly<Record<OtpFault, JsonUnknownRecord>> = {
  otpGenerate: GENERATE,
  otpSidRefresh: GENERATE,
  otpValidate: VALIDATE,
  otpVoiceOnly: { ...GENERATE, channels: [VOICE_CHANNEL] },
  otpAlphaFormat: { ...GENERATE, format: { ...OFFERED_FORMAT, type: 'alphanumeric' } },
};

const OFFERS_BY_FAULT: Readonly<Partial<Record<BeinleumiFault, JsonUnknownRecord>>> = OTP_OFFERS;

/** Every assertion done: the Transmit token. */
export const DONE_RECORD = { state: 'completed', assertions_complete: true, token: BN_TOKEN };

/** A wrong password or code: the bank's error code and its own text. */
export const REJECTED_RECORD = {
  state: 'pending',
  assertion_error_code: 4,
  assertion_error_message: BN_BANK_NOTICE,
};

/** The SMS sent: its code is eight digits, not the six the offer named. */
export const TRIGGERED_RECORD = {
  state: 'pending',
  data: { otp_format: { type: 'numeric', length: BN_OTP_LENGTH } },
};

/**
 * A pending answer offering exactly one method.
 * @param method - The offered method.
 * @returns The answer record.
 */
function offering(method: JsonUnknownRecord): JsonUnknownRecord {
  const flow = [{ type: 'authentication', methods: [method] }];
  return { state: 'pending', challenge: BN_CHALLENGE, control_flow: flow };
}

/**
 * The login answer.
 * @param fault - How the run misbehaves.
 * @returns The password offer, or the locked / expired one the fault names.
 */
export function loginRecord(fault: BeinleumiFault): JsonUnknownRecord {
  const method = LOGIN_METHODS[fault] ?? PASSWORD_METHOD;
  return offering(method);
}

/**
 * The answer to the right password.
 * @param fault - How the run misbehaves.
 * @returns The SMS offer an OTP fault names, or the completion.
 */
export function passwordRecord(fault: BeinleumiFault): JsonUnknownRecord {
  const offer = OFFERS_BY_FAULT[fault];
  if (offer === undefined) return DONE_RECORD;
  return offering(offer);
}
