/**
 * Unit tests for Flow/AuthModePolicy — the Authorization value each auth
 * scheme renders from a login token.
 */

import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { formatAuthValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/AuthModePolicy.js';

/** Config fields the formatter reads. */
type AuthFields = Pick<IApiDirectCallConfig, 'authScheme' | 'authPrefix'>;

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
