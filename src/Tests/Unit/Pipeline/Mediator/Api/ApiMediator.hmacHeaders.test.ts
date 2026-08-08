/**
 * Unit tests for ApiMediator.hmacHeaders — the transport-level per-request
 * HMAC header signer.
 *
 * The key below is SYNTHETIC (a fabricated 32-byte value, never a real
 * captured session key). These edge tests pin the fail-closed contract
 * (no key / no directive / bad directive / short key → no headers) and the
 * happy-path header assembly, without embedding any real user secret.
 */

import {
  buildHmacHeaders,
  HMAC_KEY_SLOT,
  HMAC_SIGNER_SLOT,
  NO_HMAC_HEADERS,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.hmacHeaders.js';
import type { SessionContext } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';

/** Synthetic 32-byte HMAC key as lowercase hex (fabricated — not a secret). */
const VALID_KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** Valid header-signer directive naming the three PayBox signature headers. */
const SIGNER = {
  algorithm: 'HMAC-SHA256',
  timestampHeader: 'X-Timestamp',
  nonceHeader: 'X-Nonce',
  signatureHeader: 'X-Signature',
} as const;

/** Parseable request URL used across the signing cases. */
const REQUEST_URL = 'https://x.test/api/2.0/getUserHistory';

/** UUID v4 shape the minted nonce must satisfy. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Session-context carrying the key + a valid signer directive. */
const SIGNED_SESSION: SessionContext = {
  [HMAC_KEY_SLOT]: VALID_KEY_HEX,
  [HMAC_SIGNER_SLOT]: SIGNER,
};

/** Header names the signer must emit, sorted. */
const SIGNED_HEADER_KEYS = ['X-Nonce', 'X-Signature', 'X-Timestamp'];

/** Header-name fields a complete HMAC directive must carry. */
const REQUIRED_HEADER_FIELDS = ['timestampHeader', 'nonceHeader', 'signatureHeader'] as const;

/**
 * Build a signer directive with one header-name field removed.
 * @param field - Header-name field to omit.
 * @returns Directive carrying the algorithm tag but missing `field`.
 */
function signerWithout(field: string): Record<string, unknown> {
  const entries = Object.entries(SIGNER);
  const kept = entries.filter(([key]) => key !== field);
  return Object.fromEntries(kept);
}

describe('ApiMediator.hmacHeaders.buildHmacHeaders — fail-closed (edge)', () => {
  it('returns the no-headers singleton when the session carries no key', () => {
    const result = buildHmacHeaders({ session: {}, method: 'POST', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });

  it('returns no headers when the key slot is not a string', () => {
    const session: SessionContext = { [HMAC_KEY_SLOT]: 123 };
    const result = buildHmacHeaders({ session, method: 'GET', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });

  it('returns no headers when the signer directive is absent', () => {
    const session: SessionContext = { [HMAC_KEY_SLOT]: VALID_KEY_HEX };
    const result = buildHmacHeaders({ session, method: 'POST', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });

  it('returns no headers when the signer directive is null', () => {
    const session: SessionContext = { [HMAC_KEY_SLOT]: VALID_KEY_HEX, [HMAC_SIGNER_SLOT]: null };
    const result = buildHmacHeaders({ session, method: 'POST', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });

  it('returns no headers when the signer directive is not an object', () => {
    const session: SessionContext = { [HMAC_KEY_SLOT]: VALID_KEY_HEX, [HMAC_SIGNER_SLOT]: 7 };
    const result = buildHmacHeaders({ session, method: 'POST', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });

  it('returns no headers when the signer algorithm tag is wrong', () => {
    const signer = { algorithm: 'RSA-2048' };
    const session: SessionContext = { [HMAC_KEY_SLOT]: VALID_KEY_HEX, [HMAC_SIGNER_SLOT]: signer };
    const result = buildHmacHeaders({ session, method: 'POST', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });

  it('returns no headers when signing fails (key not 32 bytes)', () => {
    const session: SessionContext = { [HMAC_KEY_SLOT]: 'abcd', [HMAC_SIGNER_SLOT]: SIGNER };
    const result = buildHmacHeaders({
      session,
      method: 'POST',
      url: REQUEST_URL,
      body: { k: 'v' },
    });
    expect(result).toBe(NO_HMAC_HEADERS);
  });
});

/**
 * A directive carrying the right algorithm tag but an incomplete set of
 * header NAMES must be refused. `toHeaderMap` spreads the names as computed
 * keys, so accepting a partial directive would emit a header literally
 * called `undefined` and silently drop the real one.
 */
describe('ApiMediator.hmacHeaders.buildHmacHeaders — partial directive (edge)', () => {
  it.each(REQUIRED_HEADER_FIELDS)('returns no headers when %s is absent', field => {
    const signer = signerWithout(field);
    const session: SessionContext = { [HMAC_KEY_SLOT]: VALID_KEY_HEX, [HMAC_SIGNER_SLOT]: signer };
    const result = buildHmacHeaders({ session, method: 'POST', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });

  it.each(REQUIRED_HEADER_FIELDS)('returns no headers when %s is an empty string', field => {
    const signer = { ...SIGNER, [field]: '' };
    const session: SessionContext = { [HMAC_KEY_SLOT]: VALID_KEY_HEX, [HMAC_SIGNER_SLOT]: signer };
    const result = buildHmacHeaders({ session, method: 'POST', url: REQUEST_URL });
    expect(result).toBe(NO_HMAC_HEADERS);
  });
});

describe('ApiMediator.hmacHeaders.buildHmacHeaders — signed headers', () => {
  it('emits the three configured headers for a POST with a body', () => {
    const result = buildHmacHeaders({
      session: SIGNED_SESSION,
      method: 'POST',
      url: REQUEST_URL,
      body: { k: 'v' },
    });
    const keys = Object.keys(result);
    keys.sort();
    expect(keys).toEqual(SIGNED_HEADER_KEYS);
    expect(result['X-Timestamp']).toMatch(/^\d+$/u);
    expect(result['X-Nonce']).toMatch(UUID_RE);
    expect(result['X-Signature']).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
  });

  it('signs a bodyless GET (empty-body hash) and still emits headers', () => {
    const result = buildHmacHeaders({ session: SIGNED_SESSION, method: 'GET', url: REQUEST_URL });
    const keys = Object.keys(result);
    keys.sort();
    expect(keys).toEqual(SIGNED_HEADER_KEYS);
    expect(result['X-Signature'].length).toBeGreaterThan(0);
  });
});
