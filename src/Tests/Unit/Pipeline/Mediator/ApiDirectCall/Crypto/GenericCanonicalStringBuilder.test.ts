/**
 * Unit tests for GenericCanonicalStringBuilder — assembles the
 * canonical string that feeds GenericCryptoSigner, driven entirely
 * by ICanonicalStringConfig data. Zero bank knowledge.
 */

import { buildCanonical } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/GenericCanonicalStringBuilder.js';
import type { ICanonicalStringConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** Reusable 3-part Pepper-shape canonical config. */
const PEPPER_SHAPE: ICanonicalStringConfig = {
  parts: ['pathAndQuery', 'clientVersion', 'bodyJson'],
  separator: '%%',
  escapeFrom: '%%',
  escapeTo: String.raw`\%`,
  sortQueryParams: true,
  clientVersion: '11.5.5',
};

describe('GenericCanonicalStringBuilder.buildCanonical — happy paths', () => {
  it('joins 3 parts with the configured separator', () => {
    const result = buildCanonical({
      canonical: PEPPER_SHAPE,
      pathAndQuery: '/api/v2/auth/bind',
      bodyJson: '{"x":1}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('/api/v2/auth/bind%%11.5.5%%{"x":1}');
    }
  });

  it('sorts query params lexicographically when sortQueryParams=true', () => {
    const result = buildCanonical({
      canonical: PEPPER_SHAPE,
      pathAndQuery: '/api/v2/path?b=2&a=1',
      bodyJson: '{}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('/api/v2/path?a=1&b=2%%11.5.5%%{}');
    }
  });

  it('preserves original order when sortQueryParams=false', () => {
    const config: ICanonicalStringConfig = { ...PEPPER_SHAPE, sortQueryParams: false };
    const result = buildCanonical({
      canonical: config,
      pathAndQuery: '/path?z=9&a=1',
      bodyJson: '{}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('/path?z=9&a=1%%11.5.5%%{}');
    }
  });

  it('escapes literal separator occurrences inside each part', () => {
    const result = buildCanonical({
      canonical: PEPPER_SHAPE,
      pathAndQuery: '/api%%path',
      bodyJson: '{"note":"%%inside"}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toContain(String.raw`\%path`);
      expect(result.value).toContain(String.raw`%%11.5.5%%`);
    }
  });
});

describe('GenericCanonicalStringBuilder.buildCanonical — edges', () => {
  it('returns empty string when parts list is empty', () => {
    const empty: ICanonicalStringConfig = { ...PEPPER_SHAPE, parts: [] };
    const result = buildCanonical({
      canonical: empty,
      pathAndQuery: '/p',
      bodyJson: '{}',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('');
  });

  it('returns Procedure.fail for an unknown CanonicalPart', () => {
    const badPart = 'noSuchPart' as unknown as 'bodyJson';
    const config: ICanonicalStringConfig = { ...PEPPER_SHAPE, parts: [badPart] };
    const result = buildCanonical({
      canonical: config,
      pathAndQuery: '/p',
      bodyJson: '{}',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unknown canonical part');
  });
});
