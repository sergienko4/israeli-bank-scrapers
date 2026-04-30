/**
 * Unit tests for Types/FieldMatch — fallback IFieldMatch builder.
 */

import {
  buildFallbackMatch,
  FALLBACK_MATCH_KEY,
} from '../../../../Scrapers/Pipeline/Types/FieldMatch.js';

describe('buildFallbackMatch', () => {
  it('sets originalKey to sentinel NONE', () => {
    const match = buildFallbackMatch('x');
    expect(match.originalKey).toBe('NONE');
  });

  it('stores provided value', () => {
    const match = buildFallbackMatch('abc');
    expect(match.value).toBe('abc');
  });

  it('uses FALLBACK_MATCH_KEY as matchingKey', () => {
    const match = buildFallbackMatch('abc');
    expect(match.matchingKey).toBe(FALLBACK_MATCH_KEY);
  });

  it('FALLBACK_MATCH_KEY equals "fallback"', () => {
    expect(FALLBACK_MATCH_KEY).toBe('fallback');
  });

  it('accepts empty string value', () => {
    const match = buildFallbackMatch('');
    expect(match.value).toBe('');
  });
});
