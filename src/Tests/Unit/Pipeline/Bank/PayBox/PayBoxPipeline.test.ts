/**
 * Unit tests for the PayBox pipeline factory.
 * Mirrors PepperPipeline.test.ts — asserts the descriptor is a
 * success Procedure, carries isHeadless=true, and the phase list
 * matches the Headless Strategy.
 */

import { buildPayBoxPipeline } from '../../../../../Scrapers/Pipeline/Banks/PayBox/PayBoxPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

describe('buildPayBoxPipeline', () => {
  it('returns success Procedure for valid options', () => {
    const opts = makeMockOptions();
    const result = buildPayBoxPipeline(opts);
    expect(result.success).toBe(true);
    assertOk(result);
  });

  it('descriptor preserves the provided options (identity)', () => {
    const opts = makeMockOptions();
    const result = buildPayBoxPipeline(opts);
    assertOk(result);
    expect(result.value.options).toBe(opts);
  });

  it('descriptor carries isHeadless=true', () => {
    const opts = makeMockOptions();
    const result = buildPayBoxPipeline(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(true);
  });

  it('phase list includes api-direct-call + api-direct-scrape', () => {
    const opts = makeMockOptions();
    const result = buildPayBoxPipeline(opts);
    assertOk(result);
    const names = result.value.phases.map((p): string => p.name);
    expect(names).toContain('api-direct-call');
    expect(names).toContain('api-direct-scrape');
    expect(names).not.toContain('login');
    expect(names).not.toContain('scrape');
  });
});
