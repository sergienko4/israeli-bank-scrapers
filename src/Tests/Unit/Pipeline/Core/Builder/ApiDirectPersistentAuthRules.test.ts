/**
 * Build rule for the persistent-auth `kind` tag: an untyped config (a JSON
 * load or a cast) that names no known kind is refused at build time,
 * before a primer lookup could miss at scrape time.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IPersistentAuthConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://ref.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };

const BASE_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  steps: [{ name: 'login', urlTag: 'auth.login', body: { shape: {} }, extractsToCarry: {} }],
};

const BOUND_DEVICE: IPersistentAuthConfig = {
  kind: 'bound-device',
  provider: 'syn-provider',
  resumeSteps: [],
  clientInstanceIdField: 'clientInstanceId',
  deviceIdField: 'deviceId',
  accountField: 'account',
  freshnessMarginSeconds: 60,
};

const DEVICE_MEMORY: IPersistentAuthConfig = {
  kind: 'device-memory',
  provider: 'syn-web',
  deviceIdField: 'did',
  accountField: 'username',
};

/**
 * Build the rule input for a call with the given persistent-auth block.
 * @param persistentAuth - Block, or false for none.
 * @returns Rule input.
 */
function inputOf(persistentAuth: IPersistentAuthConfig | false): IApiDirectRuleInput {
  if (persistentAuth === false) return { call: BASE_CALL, transport: NATIVE };
  return { call: { ...BASE_CALL, persistentAuth }, transport: NATIVE };
}

describe('validateApiDirectConfig — persistent-auth kind rule', () => {
  it.each(['legacy-device', '', 'toString'])('refuses the unknown kind "%s"', kind => {
    const block = { ...DEVICE_MEMORY, kind } as unknown as IPersistentAuthConfig;
    const input = inputOf(block);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'persistentAuth.kind: must be bound-device or device-memory',
    });
  });

  describe.each([BOUND_DEVICE, DEVICE_MEMORY])('persistent-auth $kind deviceIdField', block => {
    it.each(['', ' \t\n '])('refuses a blank deviceIdField "%s" at build time', deviceIdField => {
      const input = inputOf({ ...block, deviceIdField });
      const result = validateApiDirectConfig(input);
      expect(result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: 'persistentAuth.deviceIdField: must not be blank',
      });
    });

    it('refuses a missing deviceIdField without throwing', () => {
      const malformed = { ...block };
      Reflect.deleteProperty(malformed, 'deviceIdField');
      const input = inputOf(malformed);
      const result = validateApiDirectConfig(input);
      expect(result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: 'persistentAuth.deviceIdField: must not be blank',
      });
    });

    it.each([undefined, null, 42, {}])(
      'refuses a non-string deviceIdField %p without throwing',
      deviceIdField => {
        const malformed = { ...block };
        Reflect.set(malformed, 'deviceIdField', deviceIdField);
        const input = inputOf(malformed);
        const result = validateApiDirectConfig(input);
        expect(result).toMatchObject({
          success: false,
          errorType: ScraperErrorTypes.Generic,
          errorMessage: 'persistentAuth.deviceIdField: must not be blank',
        });
      },
    );
  });

  it.each([
    ['a bound-device block', BOUND_DEVICE],
    ['a device-memory block', DEVICE_MEMORY],
    ['no block', false],
  ] as const)('builds %s', (_label, block) => {
    const input = inputOf(block);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
