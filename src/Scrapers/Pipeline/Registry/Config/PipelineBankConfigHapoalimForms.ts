/**
 * Hapoalim login form bodies, field by field in the order the bank's own
 * client posts them. The password is sealed into `credentials` at send time;
 * `deviceId` is the text `null`, as the bank's client sends it.
 */

import type { JsonValueTemplate } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/** A form body: each field a template. */
type FormShape = Readonly<Record<string, JsonValueTemplate>>;

const EMPTY = { $literal: '' } as const;
const NULL_TEXT = { $ref: 'config.secrets.nullLiteral' } as const;
const USER_CODE = { $ref: 'creds.userCode' } as const;
const ORGANIZATION = { $ref: 'config.secrets.organization' } as const;

/** Names the user to the bank. */
const IDENTIFY_FORM: FormShape = {
  identifier: USER_CODE,
  organization: ORGANIZATION,
  mfp: EMPTY,
  deviceId: NULL_TEXT,
};

/** Sends the sealed password with the key-bound G3CmE value. */
const VERIFY_FORM: FormShape = {
  identifier: USER_CODE,
  organization: ORGANIZATION,
  credentials: EMPTY,
  mfp: EMPTY,
  deviceid: NULL_TEXT,
  executionTime: EMPTY,
  userID: USER_CODE,
  authType: { $literal: 'VERSAFE' },
  G3CmE: { $ref: 'carry.g3cme' },
  bsd: EMPTY,
};

/** Asks the bank to text the code. */
const OTP_INIT_FORM: FormShape = {
  otpchannel: { $literal: 'sms' },
  flow: { $literal: 'authenticate' },
  state: { $literal: 'logonotp' },
  mfp: EMPTY,
  deviceId: NULL_TEXT,
};

/** Sends the code, echoing the login state and the CSRF cookie. */
const OTP_VERIFY_FORM: FormShape = {
  otp: { $ref: 'carry.otp' },
  state: { $ref: 'carry.state' },
  flow: { $ref: 'carry.flow' },
  csrffield: { $ref: 'cookie.csrfcookie' },
  mfp: EMPTY,
  deviceId: NULL_TEXT,
};

export { IDENTIFY_FORM, OTP_INIT_FORM, OTP_VERIFY_FORM, VERIFY_FORM };
