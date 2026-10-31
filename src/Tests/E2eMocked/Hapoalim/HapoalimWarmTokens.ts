/**
 * Hapoalim stored tokens a warm run must refuse — a real cold-run session
 * re-bound to another account or provider, and tokens that do not open.
 * Built with the production codec and the bank's own warm-start config, so
 * only the binding or the shape is wrong.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { ICookieJarWarmStart } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  decodeWarmJar,
  encodeWarmJar,
  WARM_JAR_REJECTIONS,
} from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCookieJar.js';
import { cookieJarWarmOf } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmStartKind.js';
import { HAPOALIM_API_DIRECT_CALL } from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigHapoalim.js';
import { isOk } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import { HAPOALIM_MOCK_CREDS } from './HapoalimMockData.js';

/** Who a stored token claims to belong to. */
interface ITokenOwner {
  readonly provider: string;
  readonly account: string;
}

/** A stored token a warm run refuses, and the line its skip logs. */
export interface IStaleToken {
  readonly label: string;
  /** What the skip logs: the reason, never the token. */
  readonly logged: string;
  /** Builds the token from a real cold-run token. */
  readonly build: (coldToken: string) => string;
}

/**
 * Hapoalim's cookie-jar warm start.
 * @returns The warm-start config.
 */
function hapoalimWarm(): ICookieJarWarmStart {
  const warm = cookieJarWarmOf(HAPOALIM_API_DIRECT_CALL);
  if (warm === false) throw new ScraperError('Hapoalim has no cookie-jar warm start');
  return warm;
}

/**
 * Re-bind a cold run's session to another owner.
 * @param coldToken - The token a cold run published.
 * @param owner - The owner the new token claims.
 * @returns The same cookies under the new owner.
 */
function reboundToken(coldToken: string, owner: Partial<ITokenOwner>): string {
  const warm = hapoalimWarm();
  const own = { provider: warm.provider, account: HAPOALIM_MOCK_CREDS.userCode };
  const jar = decodeWarmJar(coldToken, { ...own, maxChars: warm.maxTokenChars });
  if (!isOk(jar)) throw new ScraperError(jar.errorMessage);
  const rebound = encodeWarmJar({ ...own, ...owner }, jar.value);
  if (!isOk(rebound)) throw new ScraperError(rebound.errorMessage);
  return rebound.value;
}

/**
 * A token one character over the warm-start limit.
 * @returns The oversize token.
 */
function oversizeToken(): string {
  const { maxTokenChars } = hapoalimWarm();
  return `v1.${'A'.repeat(maxTokenChars - 2)}`;
}

/**
 * The line a refused jar logs.
 * @param reason - The codec's rejection text.
 * @returns The skip line.
 */
function jarSkipOf(reason: string): string {
  return `warm start skipped: ${reason}`;
}

/**
 * At the 16384-char ceiling the shared seed check drops an oversize token
 * before the jar codec reads it.
 */
const MALFORMED_SEED_LINE = 'Stored warm token is malformed';

/** A `v1` token whose JSON body is no cookie jar. */
const SCHEMALESS_TOKEN = `v1.${Buffer.from('{"p":1}').toString('base64url')}`;

/**
 * The cold session, claimed by another user code.
 * @param coldToken - The token a cold run published.
 * @returns The re-bound token.
 */
function otherAccountToken(coldToken: string): string {
  return reboundToken(coldToken, { account: 'syn-hp-other-user' });
}

/**
 * The cold session, claimed by another bank.
 * @param coldToken - The token a cold run published.
 * @returns The re-bound token.
 */
function otherProviderToken(coldToken: string): string {
  return reboundToken(coldToken, { provider: 'syn-other-bank' });
}

/**
 * A token with no `v1.` prefix.
 * @returns The token.
 */
function unversionedToken(): string {
  return 'syn-not-a-token';
}

/**
 * A `v1` token whose JSON body is no cookie jar.
 * @returns The token.
 */
function schemalessToken(): string {
  return SCHEMALESS_TOKEN;
}

/** Every stored token a warm run refuses. */
export const STALE_TOKENS: readonly IStaleToken[] = [
  {
    label: 'another account',
    logged: jarSkipOf(WARM_JAR_REJECTIONS.account),
    build: otherAccountToken,
  },
  {
    label: 'another provider',
    logged: jarSkipOf(WARM_JAR_REJECTIONS.provider),
    build: otherProviderToken,
  },
  { label: 'an oversize token', logged: MALFORMED_SEED_LINE, build: oversizeToken },
  {
    label: 'a non-v1 token',
    logged: jarSkipOf(WARM_JAR_REJECTIONS.prefix),
    build: unversionedToken,
  },
  {
    label: 'a body that is no jar',
    logged: jarSkipOf(WARM_JAR_REJECTIONS.schema),
    build: schemalessToken,
  },
];
