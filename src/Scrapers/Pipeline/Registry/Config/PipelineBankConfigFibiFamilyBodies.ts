/**
 * FIBI-family Transmit request data (spec §11.2 rows 2–4b): the envelope
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

const LOGIN_DATA: JsonValueTemplate = {
  policy_request_id: { $literal: 'Login' },
  params: { bankId: { $ref: 'carry.bankNum' }, client_ip: { $ref: 'carry.client_ip' } },
  collection_result: { $ref: 'fingerprint' },
};

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

const FIBI_LOGIN_BODY = sealed(LOGIN_DATA);
const FIBI_PASSWORD_BODY = sealed(PASSWORD_DATA);
const FIBI_OTP_TRIGGER_BODY = sealed(OTP_TRIGGER_DATA);
const FIBI_OTP_BODY = sealed(OTP_DATA);

export {
  FIBI_KEY_EXCHANGE_BODY,
  FIBI_LOGIN_BODY,
  FIBI_OTP_BODY,
  FIBI_OTP_TRIGGER_BODY,
  FIBI_PASSWORD_BODY,
};
