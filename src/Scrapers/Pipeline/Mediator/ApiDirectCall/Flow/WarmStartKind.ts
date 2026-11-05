/**
 * WarmStartKind — reads a warm-start config by kind, so callers never narrow
 * the {@link IApiDirectCallConfig.warmStart} union themselves.
 */

import type {
  IApiDirectCallConfig,
  ICarryBundleWarmStart,
  ICookieJarWarmStart,
} from '../ConfigContracts/index.js';

/** A warm start whose token is bound to a provider and account (N22, N28). */
type BoundWarmStart = ICookieJarWarmStart | ICarryBundleWarmStart;

/**
 * The carry slot a carry warm start seeds and publishes.
 * @param config - API-direct-call config.
 * @returns The carry field, or '' when there is no carry warm start.
 */
function warmCarryField(config: IApiDirectCallConfig): string {
  const warm = config.warmStart;
  if (warm === undefined || !('carryField' in warm)) return '';
  return warm.carryField;
}

/**
 * The cookie-jar warm start, when the config declares one.
 * @param config - API-direct-call config.
 * @returns The cookie-jar warm start, or false.
 */
function cookieJarWarmOf(config: IApiDirectCallConfig): ICookieJarWarmStart | false {
  const warm = config.warmStart;
  if (warm?.kind !== 'cookie-jar') return false;
  return warm;
}

/**
 * The carry-bundle warm start, when the config declares one.
 * @param config - API-direct-call config.
 * @returns The carry-bundle warm start, or false.
 */
function carryBundleWarmOf(config: IApiDirectCallConfig): ICarryBundleWarmStart | false {
  const warm = config.warmStart;
  if (warm?.kind !== 'carry-bundle') return false;
  return warm;
}

/**
 * The warm start whose token is bound to a provider and account.
 * @param config - API-direct-call config.
 * @returns The cookie-jar or carry-bundle warm start, or false.
 */
function boundWarmOf(config: IApiDirectCallConfig): BoundWarmStart | false {
  const jar = cookieJarWarmOf(config);
  if (jar !== false) return jar;
  return carryBundleWarmOf(config);
}

export type { BoundWarmStart };
export { boundWarmOf, carryBundleWarmOf, cookieJarWarmOf, warmCarryField };
