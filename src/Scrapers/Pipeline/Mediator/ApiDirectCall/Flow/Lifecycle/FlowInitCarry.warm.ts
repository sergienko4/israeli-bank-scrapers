/**
 * Warm-envelope unwrapping for the jwt-claim bootstrap. PayBox stores a
 * `v1.` provider/account envelope in `otpLongTermToken`; its `pl.uId`
 * bootstrap must read the JWT inside that envelope, not the envelope text.
 */

import type { Procedure } from '../../../../Types/Procedure.js';
import { succeed } from '../../../../Types/Procedure.js';
import type { IApiDirectCallConfig, ICarryWarmStart } from '../../ConfigContracts/index.js';
import { MAX_ACCESS_TOKEN_CHARS } from '../../PersistentAuthStateRules.js';
import type { IRawCarryExpectation } from '../WarmRawCarry.js';
import { decodeRawCarry, isRawCarryToken } from '../WarmRawCarry.js';
import { carryWarmOf } from '../WarmStartKind.js';
import type { Creds } from './FlowInitCarry.types.js';

/**
 * The account values a warm token is bound to.
 * @param creds - Caller credentials.
 * @param fields - Configured account fields.
 * @returns One value per field, '' when absent.
 */
function warmAccounts(creds: Creds, fields: readonly string[]): readonly string[] {
  return fields.map((field): string => {
    const value = creds[field];
    return typeof value === 'string' ? value : '';
  });
}

/**
 * Select the account-tag key: password first, then the bank fallback.
 * @param creds - Caller credentials.
 * @param fallback - Bank-configured fallback, or ''.
 * @returns The key text.
 */
function warmTagKey(creds: Creds, fallback: string): string {
  const password = typeof creds.password === 'string' ? creds.password : '';
  return password !== '' ? password : fallback;
}

/** A carry warm start that binds new tokens to a provider and accounts. */
interface IBoundWarm extends ICarryWarmStart {
  readonly provider: string;
  readonly accountFields: readonly string[];
}

/**
 * The bound carry warm start, when the config declares one.
 * @param config - Bank call config.
 * @returns The bound config, or false.
 */
function boundWarmOf(config: IApiDirectCallConfig): IBoundWarm | false {
  const warm = carryWarmOf(config);
  if (warm === false || warm.provider === undefined || warm.accountFields === undefined) {
    return false;
  }
  return warm as IBoundWarm;
}

/**
 * Build the decode expectation for a bound warm start.
 * @param warm - Bound carry warm start.
 * @param creds - Caller credentials.
 * @returns Provider, accounts, tag key and limit.
 */
function warmExpectation(warm: IBoundWarm, creds: Creds): IRawCarryExpectation {
  const accounts = warmAccounts(creds, warm.accountFields);
  const tagKey = warmTagKey(creds, warm.accountTagKey ?? '');
  return { provider: warm.provider, accounts, tagKey, maxChars: MAX_ACCESS_TOKEN_CHARS };
}

/**
 * Unwrap a bound warm envelope to its raw value; a legacy raw token or an
 * unbound warm start passes through unchanged.
 * @param config - Bank call config.
 * @param creds - Caller credentials.
 * @param raw - Stored creds value.
 * @returns The raw value, or the envelope rejection.
 */
function unwrapWarmValue(
  config: IApiDirectCallConfig,
  creds: Creds,
  raw: string,
): Procedure<string> {
  const warm = boundWarmOf(config);
  if (warm === false || !isRawCarryToken(raw)) return succeed(raw);
  const expected = warmExpectation(warm, creds);
  return decodeRawCarry(raw, expected);
}

export default unwrapWarmValue;
