/**
 * Unit tests for Flow/AuthModePolicy — the Authorization value each auth
 * scheme renders from a login token, and the policy each scheme hands the
 * mediator under the flow's `authRecovery` (N33).
 */

import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  authPolicyOf,
  formatAuthValue,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/AuthModePolicy.js';
import type { IMediatorAuthPolicy } from '../../../../../../Scrapers/Pipeline/Types/Domain/MediatorAuthPolicy.js';

/** Config fields the auth policy reads. */
type AuthFields = Pick<IApiDirectCallConfig, 'authScheme' | 'authPrefix' | 'authRecovery'>;

const HEADER_PER_REQUEST = { installHeader: true, rearmOnReject: true };
const HEADER_WHOLE_SCRAPE = {
  installHeader: true,
  rearmOnReject: false,
  wholeScrapeRecovery: true,
};
const COOKIE_WHOLE_SCRAPE = {
  installHeader: false,
  rearmOnReject: false,
  wholeScrapeRecovery: true,
};

/**
 * Build a config carrying only the auth fields.
 * @param fields - Auth scheme and optional prefix.
 * @returns IApiDirectCallConfig literal.
 */
function makeConfig(fields: AuthFields): IApiDirectCallConfig {
  return { flow: 'sms-otp', envelope: {}, steps: [], ...fields };
}

describe('formatAuthValue', () => {
  it.each<[string, AuthFields, string]>([
    ['no scheme (raw default)', {}, 'tok'],
    ['raw', { authScheme: 'raw' }, 'tok'],
    ['bearer', { authScheme: 'bearer' }, 'Bearer tok'],
    ['prefixed', { authScheme: 'prefixed', authPrefix: 'CALAuthScheme ' }, 'CALAuthScheme tok'],
    ['none', { authScheme: 'none' }, ''],
  ])('renders %s', (_label, fields, expected) => {
    const config = makeConfig(fields);
    const value = formatAuthValue(config, 'tok');
    expect(value).toBe(expected);
  });
});

describe('authPolicyOf — authRecovery', () => {
  it.each<[string, AuthFields, IMediatorAuthPolicy]>([
    ['no recovery mode', { authScheme: 'bearer' }, HEADER_PER_REQUEST],
    ['per-request', { authScheme: 'bearer', authRecovery: 'per-request' }, HEADER_PER_REQUEST],
    ['whole-scrape', { authScheme: 'bearer', authRecovery: 'whole-scrape' }, HEADER_WHOLE_SCRAPE],
    [
      'whole-scrape cookie',
      { authScheme: 'none', authRecovery: 'whole-scrape' },
      COOKIE_WHOLE_SCRAPE,
    ],
  ])('hands the mediator the %s policy', (_label, fields, expected) => {
    const config = makeConfig(fields);
    const policy = authPolicyOf(config);
    expect(policy).toEqual(expected);
  });
});
