/**
 * Coverage for `resolveTraceBoundaryPhase` + the descriptor's
 * `traceStartAfterPhase` field — the boundary auto-resolves to the
 * LAST configured auth phase. Headless / no-login chains return the
 * empty string so the lifecycle interceptor is skipped entirely.
 */

import { PipelineBuilder } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import { resolveTraceBoundaryPhase } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilderHelpers.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import {
  makeMockOptions,
  MOCK_LOGIN_CONFIG,
  MOCK_SCRAPE,
} from '../../Infrastructure/MockFactories.js';

const MOCK_OPTIONS = makeMockOptions();

describe('resolveTraceBoundaryPhase', () => {
  it('returns empty string when hasBrowser is false', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: false,
      loginMode: 'declarative',
      hasOtpFill: true,
      hasOtpTrigger: true,
      hasPreLogin: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('');
  });

  it('returns empty string when loginMode is "none"', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'none',
      hasOtpFill: false,
      hasOtpTrigger: false,
      hasPreLogin: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('');
  });

  it('resolves to "otp-trigger" when full OTP chain is configured (gate ON at OTP-FILL entry)', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: true,
      hasOtpTrigger: true,
      hasPreLogin: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('otp-trigger');
  });

  it('resolves to "login" for OTP-fill banks without a trigger phase', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: true,
      hasOtpTrigger: false,
      hasPreLogin: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('login');
  });

  it('resolves to "login" for trigger-only banks (gate ON at OTP-TRIGGER entry)', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: false,
      hasOtpTrigger: true,
      hasPreLogin: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('login');
  });

  it('resolves to "pre-login" for non-OTP banks with a PRE-LOGIN reveal step', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: false,
      hasOtpTrigger: false,
      hasPreLogin: true,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('pre-login');
  });

  it('resolves to "home" for non-OTP banks without PRE-LOGIN (gate ON at LOGIN entry)', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: false,
      hasOtpTrigger: false,
      hasPreLogin: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('home');
  });
});

describe('PipelineBuilder/traceStartAfterPhase descriptor field', () => {
  it('stamps "home" for browser banks without OTP or pre-login', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(result);
    expect(result.value.traceStartAfterPhase).toBe('home');
  });

  it('stamps "otp-trigger" for full OTP-chain banks', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtpTrigger()
      .withOtpFill()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(result);
    expect(result.value.traceStartAfterPhase).toBe('otp-trigger');
  });

  it('emits the lifecycle interceptor on browser banks', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(result);
    const names = result.value.interceptors.map((i): string => i.name);
    expect(names).toContain('network-trace-lifecycle');
  });

  it('skips the lifecycle interceptor for headless banks', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withHeadlessMediator()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(result);
    const names = result.value.interceptors.map((i): string => i.name);
    expect(names).not.toContain('network-trace-lifecycle');
    expect(result.value.traceStartAfterPhase).toBe('');
  });
});
