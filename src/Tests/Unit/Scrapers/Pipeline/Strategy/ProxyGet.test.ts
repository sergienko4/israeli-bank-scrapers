/**
 * Unit tests for proxyGet on IFetchStrategy.
 * Verifies the method exists on BrowserFetchStrategy.
 * Rule #9: Tests first, then code.
 */

import { BrowserFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/BrowserFetchStrategy.js';

/** Whether the method exists on the prototype. */
type HasMethod = boolean;

describe('BrowserFetchStrategy/proxyGet', () => {
  it('is defined as a method on the class', () => {
    const hasMethod: HasMethod = 'proxyGet' in BrowserFetchStrategy.prototype;
    expect(hasMethod).toBe(true);
  });
});
