/**
 * Unit tests for the OneZero pipeline factory.
 * Asserts the descriptor is a success Procedure, carries isHeadless=true,
 * and the phase list matches the Headless Strategy (no browser phases).
 */

import { buildOneZeroPipeline } from '../../../../../Scrapers/Pipeline/Banks/OneZero/OneZeroPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

describe('buildOneZeroPipeline', () => {
  it('returns success Procedure for valid options', () => {
    const opts = makeMockOptions();
    const result = buildOneZeroPipeline(opts);
    assertOk(result);
  });

  it('descriptor preserves the provided options (identity)', () => {
    const opts = makeMockOptions();
    const result = buildOneZeroPipeline(opts);
    assertOk(result);
    expect(result.value.options).toBe(opts);
  });

  it('descriptor carries isHeadless=true', () => {
    const opts = makeMockOptions();
    const result = buildOneZeroPipeline(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(true);
  });

  it('phase list EXCLUDES browser phases (init/home/pre-login/dashboard/terminate)', () => {
    const opts = makeMockOptions();
    const result = buildOneZeroPipeline(opts);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).not.toContain('init');
    expect(names).not.toContain('home');
    expect(names).not.toContain('pre-login');
    expect(names).not.toContain('dashboard');
    expect(names).not.toContain('terminate');
  });

  it('phase list INCLUDES api-direct-call + scrape (otp phases folded into api-direct-call)', () => {
    const opts = makeMockOptions();
    const result = buildOneZeroPipeline(opts);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).toContain('api-direct-call');
    expect(names).toContain('scrape');
    expect(names).not.toContain('login');
    expect(names).not.toContain('otp-trigger');
    expect(names).not.toContain('otp-fill');
  });

  it('descriptor has no interceptors (headless = no popup interceptor)', () => {
    const opts = makeMockOptions();
    const result = buildOneZeroPipeline(opts);
    assertOk(result);
    expect(result.value.interceptors).toHaveLength(0);
  });
});
