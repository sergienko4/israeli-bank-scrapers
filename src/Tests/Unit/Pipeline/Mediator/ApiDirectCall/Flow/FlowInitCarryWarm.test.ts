/**
 * The jwt-claim bootstrap's warm unwrapping edges: the password-keyed path,
 * a legacy raw JWT and a config with no warm start. The PayBox config pins
 * the bound-fallback case; these pin the rest.
 */

import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import buildInitialCarry from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/FlowInitCarry.build.js';
import { encodeRawCarry } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmRawCarry.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { makeJwtExpiringInWithClaims } from '../../../../../Helpers/Jwt.js';

const PHONE = '972500000000';
const EMAIL = 'syn@example.test';
const PASSWORD = 'syn-password';
const UID = 'syn-uId';

/**
 * A config whose only seed is the `pl.uId` claim.
 * @param warmStart - Warm-start block, or none.
 * @returns API-direct-call config.
 */
function configWith(warmStart?: IApiDirectCallConfig['warmStart']): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    warmStart,
    seedCarryFromCreds: [
      {
        field: 'uId',
        bootstrap: {
          kind: 'jwt-claim',
          from: 'otpLongTermToken',
          claim: 'pl.uId',
          optional: true,
        },
      },
    ],
    steps: [],
  };
}

/** The bound warm start the tests exercise. */
const WARM = {
  credsField: 'otpLongTermToken',
  carryField: 'token',
  fromStepIndex: 1,
  provider: 'syn-bank',
  accountFields: ['phoneNumber', 'email'],
  accountTagKey: 'syn-fallback',
} as const;

/**
 * A JWT carrying the bootstrap's claim.
 * @returns Compact JWT.
 */
function jwt(): string {
  return makeJwtExpiringInWithClaims(3600, { pl: { uId: UID } });
}

describe('jwt-claim bootstrap warm unwrapping', () => {
  it('uses the caller password when one is supplied', () => {
    const raw = jwt();
    const encoded = encodeRawCarry(
      { provider: 'syn-bank', accounts: [PHONE, EMAIL], tagKey: PASSWORD },
      raw,
    );
    assertOk(encoded);
    const config = configWith(WARM);
    const carry = buildInitialCarry(
      config,
      { phoneNumber: PHONE, email: EMAIL, password: PASSWORD, otpLongTermToken: encoded.value },
      {},
    );
    assertOk(carry);
    expect(carry.value.uId).toBe(UID);
  });

  it('passes a legacy raw JWT through', () => {
    const raw = jwt();
    const config = configWith(WARM);
    const carry = buildInitialCarry(config, { phoneNumber: PHONE, otpLongTermToken: raw }, {});
    assertOk(carry);
    expect(carry.value.uId).toBe(UID);
  });

  it('passes a raw JWT through when no warm start is configured', () => {
    const raw = jwt();
    const config = configWith();
    const carry = buildInitialCarry(config, { phoneNumber: PHONE, otpLongTermToken: raw }, {});
    assertOk(carry);
    expect(carry.value.uId).toBe(UID);
  });
});
