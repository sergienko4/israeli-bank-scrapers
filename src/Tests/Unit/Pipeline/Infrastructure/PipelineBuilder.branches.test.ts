/**
 * Unit tests for PipelineBuilder.ts — resolveLoginStep branches.
 * Supplements PipelineBuilder.test.ts (which covers core builder API and phase assembly).
 */

import { PipelineBuilder } from '../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import { assertOk } from '../../../Helpers/AssertProcedure.js';
import { makeMockOptions, MOCK_DIRECT_LOGIN, MOCK_LOGIN_CONFIG } from './MockFactories.js';

/** Shared test options. */
const MOCK_OPTIONS = makeMockOptions();

describe('PipelineBuilder/resolveLoginStep-branches', () => {
  it('uses DECLARATIVE_LOGIN_STEP when OTP config with ILoginConfig', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtpTrigger()
      .withOtpFill()
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
    expect(names).toContain('otp-trigger');
    expect(names).toContain('otp-fill');
  });

  it('executes the adapted fn when withDeclarativeLogin receives a function', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_DIRECT_LOGIN)
      .build();
    assertOk(descriptor);
    const loginPhase = descriptor.value.phases[0];
    expect(loginPhase.name).toBe('login');
  });

  it('uses fn-adapted step when withDeclarativeLogin(fn) + OTP', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_DIRECT_LOGIN)
      .withOtpTrigger()
      .withOtpFill()
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toContain('login');
    expect(names).toContain('otp-trigger');
    expect(names).toContain('otp-fill');
  });
});
