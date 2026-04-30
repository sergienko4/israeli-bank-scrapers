/**
 * Unit tests for GenericJwtClaims — generic JWT exp/freshness check
 * driven by IJwtClaimsConfig. Zero bank knowledge.
 */

import type { IJwtClaimsConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { isJwtFresh } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Jwt/GenericJwtClaims.js';

const EXP_60S: IJwtClaimsConfig = {
  freshnessField: 'exp',
  skewSeconds: 60,
};

/**
 * Build a synthetic JWT with the supplied numeric claim value.
 * @param field - Claim field name (e.g. 'exp').
 * @param seconds - Unix-second value to embed.
 * @returns Compact JWT-shaped string (signature ignored).
 */
function makeJwt(field: string, seconds: number): string {
  const headerObj = { alg: 'none' };
  const headerJson = JSON.stringify(headerObj);
  const headerEnc = Buffer.from(headerJson).toString('base64url');
  const payloadObj: Record<string, number> = { [field]: seconds };
  const payloadJson = JSON.stringify(payloadObj);
  const payloadEnc = Buffer.from(payloadJson).toString('base64url');
  return `${headerEnc}.${payloadEnc}.synthetic-sig`;
}

describe('GenericJwtClaims.isJwtFresh — exp branch', () => {
  it('returns true when exp is far in the future', () => {
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    const jwt = makeJwt('exp', farFuture);
    const isFresh = isJwtFresh(jwt, EXP_60S);
    expect(isFresh).toBe(true);
  });

  it('returns false when exp is in the past', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const jwt = makeJwt('exp', past);
    const isFresh = isJwtFresh(jwt, EXP_60S);
    expect(isFresh).toBe(false);
  });

  it('returns false when exp is within the skew window', () => {
    const inSkew = Math.floor(Date.now() / 1000) + 30;
    const jwt = makeJwt('exp', inSkew);
    const isFresh = isJwtFresh(jwt, EXP_60S);
    expect(isFresh).toBe(false);
  });
});

describe('GenericJwtClaims.isJwtFresh — malformed input', () => {
  it('returns false when JWT has fewer than 2 segments', () => {
    const isFresh = isJwtFresh('not-a-jwt', EXP_60S);
    expect(isFresh).toBe(false);
  });

  it('returns false when payload is not valid base64-json', () => {
    const isFresh = isJwtFresh('aaa.invalid-base64!!.zzz', EXP_60S);
    expect(isFresh).toBe(false);
  });

  it('returns false when the configured claim is missing', () => {
    const jwt = makeJwt('nbf', 9999999999);
    const isFresh = isJwtFresh(jwt, EXP_60S);
    expect(isFresh).toBe(false);
  });
});
