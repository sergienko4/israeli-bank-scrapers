/**
 * FIBI-family Transmit request data: the envelope
 * headers and the key-exchange, login, password, SMS-code trigger and
 * SMS-code bodies, the same for every brand. Pure data (Rule #11).
 */

import type {
  IBodyTemplate,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

const FLOW_HEADER: JsonValueTemplate = {
  type: { $literal: 'flow_id' },
  flow_id: { $ref: 'carry.flowId' },
};
const UID_HEADER: JsonValueTemplate = { type: { $literal: 'uid' }, uid: { $ref: 'carry.uid' } };

const ACTION: JsonValueTemplate = { $literal: 'authentication' };
const AUTHENTICATE: JsonValueTemplate = { $literal: 'authenticate' };
const OTP: JsonValueTemplate = { $literal: 'otp' };
const FCH: JsonValueTemplate = { $ref: 'carry.challenge' };
const OTP_ID: JsonValueTemplate = { $ref: 'carry.otpAssertionId' };

/** The SDK's key-exchange probe: the client's public point and a fixed text. */
const FIBI_KEY_EXCHANGE_BODY: IBodyTemplate = {
  shape: {
    headers: [
      FLOW_HEADER,
      {
        type: { $literal: 'key_exchange' },
        scheme: { $literal: 2 },
        y: { $ref: 'carry.ecdhPublic' },
      },
    ],
    data: { r: { $literal: 'Hello Encrypted World' } },
  },
};

/**
 * The login data: the bank's number and the device collection.
 *
 * <p>The number comes from the brand record, not the portal page, and the
 * client address the page used to supply is not required by the bank.</p>
 * @param bankNum - Brand bank number, e.g. `031`.
 * @returns The login data template.
 */
function loginData(bankNum: string): JsonValueTemplate {
  return {
    policy_request_id: { $literal: 'Login' },
    params: { bankId: { $literal: bankNum } },
    collection_result: { $ref: 'fingerprint' },
  };
}

const PASSWORD_DATA: JsonValueTemplate = {
  action: ACTION,
  assert: AUTHENTICATE,
  assertion_id: { $ref: 'carry.pwdAssertionId' },
  fch: FCH,
  data: { password: { $ref: 'creds.password' } },
  method: { $literal: 'password' },
};

/** The SDK triggers the code on the chosen target, by its index in the channel. */
const OTP_TRIGGER_DATA: JsonValueTemplate = {
  action: ACTION,
  assert: OTP,
  assertion_id: OTP_ID,
  fch: FCH,
  data: { target_id: { $ref: 'carry.otpTargetId' }, channel_index: { $literal: 0 } },
  method: OTP,
};

const OTP_DATA: JsonValueTemplate = {
  action: ACTION,
  assert: AUTHENTICATE,
  assertion_id: OTP_ID,
  fch: FCH,
  data: { otp: { $ref: 'carry.otpCode' } },
  method: OTP,
};

/**
 * A sealed envelope: the flow and user headers, then the data.
 * @param data - The envelope's data.
 * @returns The body template.
 */
function sealed(data: JsonValueTemplate): IBodyTemplate {
  return { shape: { headers: [FLOW_HEADER, UID_HEADER], data } };
}

const FIBI_PASSWORD_BODY = sealed(PASSWORD_DATA);
const FIBI_OTP_TRIGGER_BODY = sealed(OTP_TRIGGER_DATA);
const FIBI_OTP_BODY = sealed(OTP_DATA);

/**
 * The sealed login body for one brand.
 * @param bankNum - Brand bank number.
 * @returns The body template.
 */
function fibiLoginBody(bankNum: string): IBodyTemplate {
  const data = loginData(bankNum);
  return sealed(data);
}

export {
  FIBI_KEY_EXCHANGE_BODY,
  FIBI_OTP_BODY,
  FIBI_OTP_TRIGGER_BODY,
  FIBI_PASSWORD_BODY,
  fibiLoginBody,
};
