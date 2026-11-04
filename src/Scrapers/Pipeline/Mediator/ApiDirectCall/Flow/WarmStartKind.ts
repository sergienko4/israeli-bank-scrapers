/**
 * WarmStartKind — reads a warm-start config by kind, so callers never narrow
 * the {@link IApiDirectCallConfig.warmStart} union themselves.
 */

import type { IApiDirectCallConfig, ICookieJarWarmStart } from '../ConfigContracts/index.js';

/**
 * The carry slot a carry warm start seeds and publishes.
 * @param config - API-direct-call config.
 * @returns The carry field, or '' when there is no carry warm start.
 */
function warmCarryField(config: IApiDirectCallConfig): string {
  const warm = config.warmStart;
  if (warm === undefined || warm.kind === 'cookie-jar') return '';
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

export { cookieJarWarmOf, warmCarryField };
