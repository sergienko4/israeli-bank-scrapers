/**
 * PipelineBuilder phase-assembly tests — split from PipelineBuilder.test.ts for 300-line limit.
 * Covers: phase ordering, init/terminate placement, optional phases insertion.
 */

import { PipelineBuilder } from '../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import { assertOk } from '../../../Helpers/AssertProcedure.js';
import {
  makeMockOptions,
  MOCK_DIRECT_LOGIN,
  MOCK_LOGIN_CONFIG,
  MOCK_NATIVE_LOGIN,
  MOCK_SCRAPE,
} from './MockFactories.js';

/** Shared test options. */
const MOCK_OPTIONS = makeMockOptions();

describe('PipelineBuilder/phase-assembly', () => {
  it('declarative login produces a login phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    expect(names).toContain('login');
  });

  it('withBrowser adds init phase at the start', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const firstPhase = desc.phases[0];
    expect(firstPhase.name).toBe('init');
  });

  it('withLoginAndOtpTrigger + withLoginAndOptCodeFill adds both OTP phases', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withLoginAndOtpTrigger()
      .withLoginAndOptCodeFill()
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    const loginIdx = names.indexOf('login');
    const triggerIdx = names.indexOf('otp-trigger');
    const fillIdx = names.indexOf('otp-fill');
    expect(triggerIdx).toBeGreaterThan(loginIdx);
    expect(fillIdx).toBeGreaterThan(triggerIdx);
  });

  it('withLoginAndOptCodeFill alone adds only otp-fill (no trigger)', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withLoginAndOptCodeFill()
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    expect(names).toContain('otp-fill');
    expect(names).not.toContain('otp-trigger');
  });

  it('dashboard is mandatory for browser banks', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    expect(names).toContain('dashboard');
  });

  it('withScraper adds scrape phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    expect(names).toContain('scrape');
  });

  it('phases are ordered: init → login → otp-trigger → otp-fill → dashboard → scrape', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withLoginAndOtpTrigger()
      .withLoginAndOptCodeFill()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    const initIdx = names.indexOf('init');
    const loginIdx = names.indexOf('login');
    const triggerIdx = names.indexOf('otp-trigger');
    const fillIdx = names.indexOf('otp-fill');
    const dashIdx = names.indexOf('dashboard');
    const scrapeIdx = names.indexOf('scrape');
    expect(initIdx).toBeLessThan(loginIdx);
    expect(loginIdx).toBeLessThan(triggerIdx);
    expect(triggerIdx).toBeLessThan(fillIdx);
    expect(fillIdx).toBeLessThan(dashIdx);
    expect(dashIdx).toBeLessThan(scrapeIdx);
  });

  it('without browser, no init phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    expect(names).not.toContain('init');
  });

  it('login-only produces exactly 1 phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.phases.length).toBe(1);
    expect(desc.phases[0].name).toBe('login');
  });

  it('withBrowser adds terminate phase at the end', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    const lastPhase = names.at(-1);
    expect(lastPhase).toBe('terminate');
  });

  it('optional phases are inserted before terminate', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withLoginAndOtpTrigger()
      .withLoginAndOptCodeFill()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    const terminateIdx = names.lastIndexOf('terminate');
    const scrapeIdx = names.indexOf('scrape');
    expect(scrapeIdx).toBeLessThan(terminateIdx);
  });
});

describe('PipelineBuilder/behavioral', () => {
  it('declarative login with ILoginConfig builds a named login phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const loginPhase = descriptor.value.phases[0];
    expect(loginPhase.name).toBe('login');
    expect(typeof loginPhase.pre).toBe('function');
    expect(typeof loginPhase.action).toBe('function');
    expect(typeof loginPhase.post).toBe('function');
    expect(typeof loginPhase.run).toBe('function');
  });
});
