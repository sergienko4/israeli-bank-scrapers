/**
 * Unit tests for the Pepper pipeline factory.
 * Asserts the descriptor is a success Procedure, carries isHeadless=true,
 * and the phase list matches the Headless Strategy.
 */

import { buildPepperPipeline } from '../../../../../Scrapers/Pipeline/Banks/Pepper/PepperPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

describe('buildPepperPipeline', () => {
  it('returns success Procedure for valid options', () => {
    const opts = makeMockOptions();
    const result = buildPepperPipeline(opts);
    assertOk(result);
  });

  it('descriptor preserves the provided options (identity)', () => {
    const opts = makeMockOptions();
    const result = buildPepperPipeline(opts);
    assertOk(result);
    expect(result.value.options).toBe(opts);
  });

  it('descriptor carries isHeadless=true', () => {
    const opts = makeMockOptions();
    const result = buildPepperPipeline(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(true);
  });

  it('phase list excludes browser phases and includes api-direct-call + scrape', () => {
    const opts = makeMockOptions();
    const result = buildPepperPipeline(opts);
    assertOk(result);
    const names = result.value.phases.map((p): string => p.name);
    expect(names).not.toContain('init');
    expect(names).not.toContain('home');
    expect(names).not.toContain('dashboard');
    expect(names).not.toContain('login');
    expect(names).not.toContain('otp-trigger');
    expect(names).not.toContain('otp-fill');
    expect(names).toContain('api-direct-call');
    expect(names).toContain('scrape');
  });
});
