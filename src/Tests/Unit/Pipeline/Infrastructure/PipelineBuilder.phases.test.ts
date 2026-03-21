/**
 * PipelineBuilder phase-assembly tests — split from PipelineBuilder.test.ts for 300-line limit.
 * Covers: phase ordering, init/terminate placement, optional phases insertion.
 */

import type { OtpConfig } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { PipelineBuilder } from '../../../../Scrapers/Pipeline/PipelineBuilder.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../Helpers/AssertProcedure.js';

/** Minimal ScraperOptions for testing. */
const MOCK_OPTIONS = {
  companyId: 'test' as never,
  startDate: new Date('2024-01-01'),
} as never;

/** Minimal ILoginConfig stub. */
const MOCK_LOGIN_CONFIG: ILoginConfig = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent', value: 'Login' },
  possibleResults: {},
} as never;

/**
 * Stub login function for direct-POST mode.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_DIRECT_LOGIN = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/**
 * Stub login function for native mode.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_NATIVE_LOGIN = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/**
 * Stub scrape function.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_SCRAPE = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/** Minimal OTP config. */
const MOCK_OTP_CONFIG: OtpConfig = { kind: 'api' };

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

  it('withOtp adds otp phase after login', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtp(MOCK_OTP_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    const loginIdx = names.indexOf('login');
    const otpIdx = names.indexOf('otp');
    expect(otpIdx).toBeGreaterThan(loginIdx);
  });

  it('withDashboard adds dashboard phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withDashboard()
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

  it('phases are ordered: init → login → otp → dashboard → scrape', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtp(MOCK_OTP_CONFIG)
      .withDashboard()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const names = desc.phases.map(p => p.name);
    const initIdx = names.indexOf('init');
    const loginIdx = names.indexOf('login');
    const otpIdx = names.indexOf('otp');
    const dashIdx = names.indexOf('dashboard');
    const scrapeIdx = names.indexOf('scrape');
    expect(initIdx).toBeLessThan(loginIdx);
    expect(loginIdx).toBeLessThan(otpIdx);
    expect(otpIdx).toBeLessThan(dashIdx);
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
      .withOtp(MOCK_OTP_CONFIG)
      .withDashboard()
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
  it('declarative login with ILoginConfig builds pre+action+post steps', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const loginPhase = desc.phases[0];
    expect(loginPhase.pre.has).toBe(true);
    expect(loginPhase.action.name).toBe('login-action');
    expect(loginPhase.post.has).toBe(true);
  });
});
