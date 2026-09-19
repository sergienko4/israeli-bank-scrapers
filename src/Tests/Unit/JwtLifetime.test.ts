/**
 * JwtLifetime — proves the decoder that turns a stored long-term token into a
 * measured `iat`→`exp` interval. Written so the ten-year figure quoted in
 * docs/banks/onezero.md is reproducible from the token itself rather than
 * asserted on the strength of a scrape that never reads either claim.
 */

import { measureJwtLifetime } from '../E2eReal/JwtLifetime.js';

const SECONDS_PER_DAY = 86400;

/**
 * Build an unsigned compact JWT carrying the given numeric claims.
 * @param claims - Payload claims to encode.
 * @returns Compact-serialisation token with a throwaway signature segment.
 */
function makeToken(claims: Record<string, unknown>): string {
  const headerJson = JSON.stringify({ alg: 'none' });
  const claimsJson = JSON.stringify(claims);
  const header = Buffer.from(headerJson).toString('base64url');
  const payload = Buffer.from(claimsJson).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('measureJwtLifetime', () => {
  it('reports the iat→exp interval in whole days', () => {
    const iat = 1789804782;
    const token = makeToken({ iat, exp: iat + 30 * SECONDS_PER_DAY });
    expect(measureJwtLifetime(token).days).toBe(30);
  });

  it('returns the raw claims alongside the interval', () => {
    const iat = 1789804782;
    const token = makeToken({ iat, exp: iat + SECONDS_PER_DAY });
    const measured = measureJwtLifetime(token);
    expect(measured.iatSec).toBe(iat);
    expect(measured.expSec).toBe(iat + SECONDS_PER_DAY);
  });

  it('measures the ten-year OneZero shape as 3650 days', () => {
    const token = makeToken({ iat: 1789804782, exp: 2105164782 });
    expect(measureJwtLifetime(token).days).toBe(3650);
  });

  it('reports a fractional interval rather than rounding it away', () => {
    const iat = 1000;
    const token = makeToken({ iat, exp: iat + SECONDS_PER_DAY / 2 });
    expect(measureJwtLifetime(token).days).toBeCloseTo(0.5);
  });

  it('rejects a value that is not a three-segment JWT', () => {
    expect(() => measureJwtLifetime('not.a-jwt')).toThrow('compact JWT');
  });

  it('rejects a payload segment that is not a JSON object', () => {
    const headerJson = JSON.stringify({ alg: 'none' });
    const header = Buffer.from(headerJson).toString('base64url');
    const payload = Buffer.from('"a string"').toString('base64url');
    const token = `${header}.${payload}.sig`;
    expect(() => measureJwtLifetime(token)).toThrow('payload');
  });

  it('rejects a token whose exp claim is absent', () => {
    const token = makeToken({ iat: 1 });
    expect(() => measureJwtLifetime(token)).toThrow('exp');
  });

  it('rejects a token whose iat claim is not numeric', () => {
    const token = makeToken({ iat: 'yesterday', exp: 2 });
    expect(() => measureJwtLifetime(token)).toThrow('iat');
  });
});
