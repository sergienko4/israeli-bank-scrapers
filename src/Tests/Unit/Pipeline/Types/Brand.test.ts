/**
 * Unit tests for Types/Brand — verify the live SafeUrlForLog mint helper
 * returns the same primitive value (zero-cost cast).
 */

import { mintSafeUrlForLog } from '../../../../Scrapers/Pipeline/Types/Brand.js';

describe('Brand — SafeUrlForLog', () => {
  it('mintSafeUrlForLog preserves the underlying string value', () => {
    const safeUrl = mintSafeUrlForLog('https://example.com/path');
    expect(safeUrl).toBe('https://example.com/path');
  });
});
