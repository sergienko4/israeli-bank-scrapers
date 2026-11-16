/**
 * Unit tests for the Pepper pipeline factory.
 * Asserts the descriptor is a success Procedure and the phase list matches
 * the HTTP-only phase sequence.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { factoryOf } from '../../Banks/PipelineRegistryTestHelpers.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

const BUILD_PEPPER = factoryOf(CompanyTypes.Pepper);

describe('BUILD_PEPPER', () => {
  it('returns success Procedure for valid options', () => {
    const opts = makeMockOptions();
    const result = BUILD_PEPPER(opts);
    expect(result.success).toBe(true);
    assertOk(result);
  });

  it('descriptor preserves the provided options (identity)', () => {
    const opts = makeMockOptions();
    const result = BUILD_PEPPER(opts);
    assertOk(result);
    expect(result.value.options).toBe(opts);
  });

  it('phase list excludes browser phases and includes api-direct-call + api-direct-scrape', () => {
    const opts = makeMockOptions();
    const result = BUILD_PEPPER(opts);
    assertOk(result);
    const names = result.value.phases.map((p): string => p.name);
    expect(names).not.toContain('init');
    expect(names).not.toContain('home');
    expect(names).not.toContain('dashboard');
    expect(names).not.toContain('login');
    expect(names).not.toContain('otp-trigger');
    expect(names).not.toContain('otp-fill');
    expect(names).not.toContain('scrape');
    expect(names).toContain('api-direct-call');
    expect(names).toContain('api-direct-scrape');
  });
});
