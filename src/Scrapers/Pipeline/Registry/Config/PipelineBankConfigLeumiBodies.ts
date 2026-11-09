/**
 * Leumi website Transmit envelopes for key exchange and password login.
 */

import type {
  IBodyTemplate,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

const FLOW: JsonValueTemplate = {
  type: { $literal: 'flow_id' },
  flow_id: { $ref: 'carry.flowId' },
};
const UID: JsonValueTemplate = {
  type: { $literal: 'uid' },
  uid: { $ref: 'creds.username' },
};

const LEUMI_EXCHANGE_BODY: IBodyTemplate = {
  shape: {
    headers: [
      FLOW,
      {
        type: { $literal: 'key_exchange' },
        scheme: { $literal: 2 },
        y: { $ref: 'carry.ecdhPublic' },
      },
    ],
    data: { r: { $literal: 'Hello Encrypted World' } },
  },
};

const LEUMI_LOGIN_BODY: IBodyTemplate = {
  shape: {
    headers: [FLOW, UID],
    data: {
      policy_request_id: { $literal: 'authenticate' },
      params: {
        trackingCode: { $ref: 'carry.trackingCode' },
        customerAccountId: { $literal: '' },
        langNum: { $ref: 'carry.langNum' },
        purpose: { $literal: '' },
        sysNum: { $ref: 'carry.sysNum' },
      },
      collection_result: { $ref: 'fingerprint' },
    },
  },
};

const LEUMI_PASSWORD_BODY: IBodyTemplate = {
  shape: {
    headers: [FLOW, UID],
    data: {
      action: { $literal: 'authentication' },
      assert: { $literal: 'authenticate' },
      assertion_id: { $ref: 'carry.pwdAssertionId' },
      fch: { $ref: 'carry.challenge' },
      data: { password: { $ref: 'creds.password' } },
      method: { $literal: 'password' },
    },
  },
};

export { LEUMI_EXCHANGE_BODY, LEUMI_LOGIN_BODY, LEUMI_PASSWORD_BODY };
