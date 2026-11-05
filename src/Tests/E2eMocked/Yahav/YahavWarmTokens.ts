/**
 * Yahav stored tokens the warm start must skip for a cold login: tokens of
 * another provider or account, without a slot, of another version, or cut
 * short. Each is rebuilt from a real cold-run token through the bundle codec.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { ICarryBundleWarmStart } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IWarmBundle } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCarryBundle.js';
import {
  decodeWarmBundle,
  encodeWarmBundle,
} from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCarryBundle.js';
import { carryBundleWarmOf } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmStartKind.js';
import { YAHAV_API_DIRECT_CALL } from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigYahav.js';
import { isOk } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import { YAHAV_MOCK_CREDS } from './YahavMockData.js';

/** A stored token the warm start must skip. */
export interface IStaleToken {
  readonly label: string;
  /** Builds the token from a real cold-run token. */
  readonly build: (coldToken: string) => string;
}

const OWN_ACCOUNTS = [YAHAV_MOCK_CREDS.num, YAHAV_MOCK_CREDS.nationalID];

/**
 * Yahav's warm start.
 * @returns The carry-bundle warm start.
 */
function yahavWarm(): ICarryBundleWarmStart {
  const warm = carryBundleWarmOf(YAHAV_API_DIRECT_CALL);
  if (warm === false) throw new ScraperError('Yahav has no carry-bundle warm start');
  return warm;
}

/**
 * Open a cold-run token.
 * @param coldToken - The token.
 * @returns Its bundle.
 */
function openToken(coldToken: string): IWarmBundle {
  const warm = yahavWarm();
  const expected = { provider: warm.provider, accounts: OWN_ACCOUNTS, slots: warm.slots };
  const bundle = decodeWarmBundle(coldToken, {
    ...expected,
    hasCookies: true,
    maxChars: warm.maxTokenChars,
  });
  if (!isOk(bundle)) throw new ScraperError(bundle.errorMessage);
  return bundle.value;
}

/** What a re-seal changes: the token's owner, or its bundle. */
interface ITokenChange {
  /** Provider or accounts to bind the token to instead. */
  readonly owner?: { readonly provider?: string; readonly accounts?: readonly string[] };
  /** Rewrites the token's bundle. */
  readonly edit?: (bundle: IWarmBundle) => IWarmBundle;
}

/**
 * Re-seal a cold-run token under another owner or with other slots.
 * @param coldToken - The token.
 * @param change - What to change.
 * @returns The re-sealed token.
 */
function resealed(coldToken: string, change: ITokenChange): string {
  const bundle = openToken(coldToken);
  const identity = { provider: yahavWarm().provider, accounts: OWN_ACCOUNTS, ...change.owner };
  const token = encodeWarmBundle(identity, change.edit?.(bundle) ?? bundle);
  if (!isOk(token)) throw new ScraperError(token.errorMessage);
  return token.value;
}

/**
 * A bundle without its device handle.
 * @param bundle - The bundle.
 * @returns It, less the `mag` slot.
 */
function withoutMag(bundle: IWarmBundle): IWarmBundle {
  const { mag: dropped, ...carry } = bundle.carry;
  return dropped === '' ? bundle : { ...bundle, carry };
}

export const STALE_TOKENS: readonly IStaleToken[] = [
  {
    label: 'a token of another provider',
    /**
     * Bind the token to another provider.
     * @param cold - The cold-run token.
     * @returns The re-bound token.
     */
    build: (cold: string): string => resealed(cold, { owner: { provider: 'synthetic-other' } }),
  },
  {
    label: 'a token of another account',
    /**
     * Bind the token to another user.
     * @param cold - The cold-run token.
     * @returns The re-bound token.
     */
    build: (cold: string): string =>
      resealed(cold, { owner: { accounts: ['SYN0099', '087654321'] } }),
  },
  {
    label: 'a token without its device handle',
    /**
     * Drop the token's `mag` slot.
     * @param cold - The cold-run token.
     * @returns The re-sealed token.
     */
    build: (cold: string): string => resealed(cold, { edit: withoutMag }),
  },
  {
    label: 'a token of another version',
    /**
     * Re-label the token's version.
     * @param cold - The cold-run token.
     * @returns The re-labelled token.
     */
    build: (cold: string): string => cold.replace(/^v1\./, 'v2.'),
  },
  {
    label: 'a token cut short',
    /**
     * Cut the token in half.
     * @param cold - The cold-run token.
     * @returns Its first half.
     */
    build: (cold: string): string => {
      const half = Math.floor(cold.length / 2);
      return cold.slice(0, half);
    },
  },
];
