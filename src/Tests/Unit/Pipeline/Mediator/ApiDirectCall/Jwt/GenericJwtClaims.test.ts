/**
 * Unit tests for GenericJwtClaims — generic JWT exp/freshness check
 * driven by IJwtClaimsConfig. Zero bank knowledge.
 */

import type { IJwtClaimsConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
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

/**
 * Build a synthetic JWT with arbitrary payload claims.
 * @param claims - Payload claims to embed.
 * @returns Compact JWT-shaped string (signature ignored).
 */
function makeClaimsJwt(claims: Readonly<Record<string, unknown>>): string {
  const headerJson = JSON.stringify({ alg: 'none' });
  const headerEnc = Buffer.from(headerJson).toString('base64url');
  const payloadJson = JSON.stringify(claims);
  const payloadEnc = Buffer.from(payloadJson).toString('base64url');
  return `${headerEnc}.${payloadEnc}.synthetic-sig`;
}

describe('GenericJwtClaims.isJwtFresh — issuer and audience binding', () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const claims = { exp: future, iss: 'syn-issuer', aud: ['syn-audience', 'syn-other'] };
  const jwt = makeClaimsJwt(claims);

  it('accepts a matching issuer and audience', () => {
    const config: IJwtClaimsConfig = { ...EXP_60S, issuer: 'syn-issuer', audience: 'syn-audience' };
    const isFresh = isJwtFresh(jwt, config);
    expect(isFresh).toBe(true);
  });

  it('rejects a different issuer', () => {
    const config: IJwtClaimsConfig = { ...EXP_60S, issuer: 'syn-other' };
    const isFresh = isJwtFresh(jwt, config);
    expect(isFresh).toBe(false);
  });

  it('rejects a missing issuer when one is expected', () => {
    const jwt = makeClaimsJwt({ exp: future });
    const config: IJwtClaimsConfig = { ...EXP_60S, issuer: 'syn-issuer' };
    const isFresh = isJwtFresh(jwt, config);
    expect(isFresh).toBe(false);
  });

  it('rejects a different audience in a string claim', () => {
    const jwt = makeClaimsJwt({ exp: future, aud: 'syn-other' });
    const config: IJwtClaimsConfig = { ...EXP_60S, audience: 'syn-audience' };
    const isFresh = isJwtFresh(jwt, config);
    expect(isFresh).toBe(false);
  });

  it('accepts a string audience that matches', () => {
    const jwt = makeClaimsJwt({ exp: future, aud: 'syn-audience' });
    const config: IJwtClaimsConfig = { ...EXP_60S, audience: 'syn-audience' };
    const isFresh = isJwtFresh(jwt, config);
    expect(isFresh).toBe(true);
  });

  it('ignores both expectations when none are configured', () => {
    const jwt = makeClaimsJwt({ exp: future, iss: 'any', aud: 'any' });
    const isFresh = isJwtFresh(jwt, EXP_60S);
    expect(isFresh).toBe(true);
  });
});

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

  it('returns false when payload decodes to JSON null root', () => {
    const headerJson = JSON.stringify({ alg: 'none' });
    const headerBuffer = Buffer.from(headerJson);
    const headerEnc = headerBuffer.toString('base64url');
    const nullPayloadBuffer = Buffer.from('null');
    const nullPayloadEnc = nullPayloadBuffer.toString('base64url');
    const jwt = `${headerEnc}.${nullPayloadEnc}.sig`;
    const isFresh = isJwtFresh(jwt, EXP_60S);
    expect(isFresh).toBe(false);
  });

  it('returns false when configured claim value is not a number', () => {
    const headerJson = JSON.stringify({ alg: 'none' });
    const headerBuffer = Buffer.from(headerJson);
    const headerEnc = headerBuffer.toString('base64url');
    const stringExpJson = JSON.stringify({ exp: '1234567890' });
    const stringExpBuffer = Buffer.from(stringExpJson);
    const stringExpEnc = stringExpBuffer.toString('base64url');
    const jwt = `${headerEnc}.${stringExpEnc}.sig`;
    const isFresh = isJwtFresh(jwt, EXP_60S);
    expect(isFresh).toBe(false);
  });
});
