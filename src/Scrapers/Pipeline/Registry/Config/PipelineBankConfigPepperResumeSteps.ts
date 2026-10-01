/**
 * Pepper durable-resume steps — renew an expired access token on an already
 * bound device: signed `/auth/login`, then one password assertion.
 *
 * No bind, no OTP method and no pre-hook. Envelope pieces are reused from the
 * enrollment steps so both flows sign byte-identical header, params and
 * password-assertion shapes; only the server-selected action differs. Pure
 * data (Rule #11).
 */

import { AID, LOCALE } from './PipelineBankConfigPepperFingerprint.js';
import { ASSERT_PWD_STEP, BIND_STEP } from './PipelineBankConfigPepperSteps.js';

/** Step 1: /auth/login — start an authentication on the persisted device. */
const LOGIN_STEP = {
  name: 'login' as const,
  urlTag: 'auth.login' as const,
  queryTemplate: {
    aid: { $literal: AID },
    did: { $ref: 'carry.deviceId' as const },
    locale: { $literal: LOCALE },
    tsm: { $ref: 'nowMs' as const },
  },
  body: {
    shape: {
      headers: BIND_STEP.body.shape.headers,
      data: {
        collection_result: { $ref: 'fingerprint' as const },
        policy_request_id: { $literal: 'default' },
        params: BIND_STEP.body.shape.data.params,
      },
    },
  },
  extractsToCarry: {
    challenge: '/data/challenge',
    pwdAction: '/data/control_flow/0/type',
    pwdAssertionId: '/data/control_flow/0/methods/?type=password/assertion_id',
    sessionId: '/headers/*session_id',
  },
  cookieJar: true,
};

/** Step 2: /auth/assert (method=password) under the server-selected action. */
const RESUME_ASSERT_STEP = {
  ...ASSERT_PWD_STEP,
  body: {
    shape: {
      headers: ASSERT_PWD_STEP.body.shape.headers,
      data: {
        ...ASSERT_PWD_STEP.body.shape.data,
        action: { $ref: 'carry.pwdAction' as const },
      },
    },
  },
  extractsToCarry: { token: '/data/token' },
};

/** Ordered resume list — login, then password assertion. */
const PEPPER_RESUME_STEPS = [LOGIN_STEP, RESUME_ASSERT_STEP];

export default PEPPER_RESUME_STEPS;
export { PEPPER_RESUME_STEPS };
