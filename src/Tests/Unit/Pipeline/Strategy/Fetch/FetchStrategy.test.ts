/**
 * Unit tests for Strategy/Fetch/FetchStrategy — default opts & type surface.
 */

import { DEFAULT_FETCH_OPTS } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';

describe('DEFAULT_FETCH_OPTS', () => {
  it('carries an empty extraHeaders record', () => {
    expect(DEFAULT_FETCH_OPTS.extraHeaders).toEqual({});
  });

  it('is safe to reference as a default value', () => {
    const myOpts = { ...DEFAULT_FETCH_OPTS };
    expect(myOpts.extraHeaders).toEqual({});
  });
});
