/**
 * Coverage for `resolveTraceBoundaryPhase` + the descriptor's
 * `traceStartAfterPhase` field — the boundary is the last phase before
 * the auth phases (INIT). Headless / no-login chains return the empty
 * string so the lifecycle interceptor is skipped entirely.
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
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('');
  });

  it('returns empty string when loginMode is "none"', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'none',
      hasOtpFill: false,
      hasOtpTrigger: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('');
  });

  it('resolves to "init" when full OTP chain is configured — OTP does not push the boundary later', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: true,
      hasOtpTrigger: true,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('init');
  });

  it('resolves to "init" for OTP-fill banks without trigger', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: true,
      hasOtpTrigger: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('init');
  });

  it('resolves to "init" for trigger-only banks', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: false,
      hasOtpTrigger: true,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('init');
  });

  it('resolves to "init" for non-OTP banks (gate ON at LOGIN entry)', () => {
    const phase = resolveTraceBoundaryPhase({
      hasBrowser: true,
      loginMode: 'declarative',
      hasOtpFill: false,
      hasOtpTrigger: false,
    } as Parameters<typeof resolveTraceBoundaryPhase>[0]);
    expect(phase).toBe('init');
  });
});

describe('PipelineBuilder/traceStartAfterPhase descriptor field', () => {
  it('stamps "init" for browser banks without OTP', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(result);
    expect(result.value.traceStartAfterPhase).toBe('init');
  });

  it('stamps "init" for full OTP-chain banks', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtpTrigger()
      .withOtpFill()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(result);
    expect(result.value.traceStartAfterPhase).toBe('init');
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
