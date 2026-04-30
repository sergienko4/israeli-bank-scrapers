/**
 * Unit tests for PipelineBuilder — Headless Strategy branch.
 * Verifies that withHeadlessMediator() skips browser phases
 * (HOME / PRE-LOGIN / DASHBOARD / TERMINATE), retains LOGIN + OTP + SCRAPE,
 * and that non-headless builds keep the default HTML descriptor (back-compat).
 */

import type { ScraperOptions } from '../../../../../Scrapers/Base/Interface.js';
import { createPipelineBuilder } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

/**
 * Stub native-login function — succeeds without mutation.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
function stubLogin(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const ok = succeed(ctx);
  return Promise.resolve(ok);
}

/**
 * Stub scrape function — succeeds without mutation (sealed-action signature).
 * @param ctx - Sealed action context.
 * @returns Resolved succeed procedure.
 */
function stubScrape(ctx: IActionContext): Promise<Procedure<IPipelineContext>> {
  const full = ctx as unknown as IPipelineContext;
  const ok = succeed(full);
  return Promise.resolve(ok);
}

/**
 * Build a headless descriptor with native login + scraper.
 * @param opts - Scraper options to seed the builder.
 * @returns Pipeline descriptor Procedure.
 */
function buildHeadlessDescriptor(opts: ScraperOptions): Procedure<IPipelineDescriptor> {
  const builder = createPipelineBuilder();
  const seeded = builder.withOptions(opts);
  const headless = seeded.withHeadlessMediator();
  const withLogin = headless.withNativeLogin(stubLogin);
  const withScrape = withLogin.withScraper(stubScrape);
  return withScrape.build();
}

/**
 * Build a headless descriptor that also enables the OTP trigger + fill phases.
 * @param opts - Scraper options to seed the builder.
 * @returns Pipeline descriptor Procedure.
 */
function buildHeadlessOtpDescriptor(opts: ScraperOptions): Procedure<IPipelineDescriptor> {
  const builder = createPipelineBuilder();
  const seeded = builder.withOptions(opts);
  const headless = seeded.withHeadlessMediator();
  const withLogin = headless.withNativeLogin(stubLogin);
  const withTrigger = withLogin.withLoginAndOtpTrigger();
  const withFill = withTrigger.withLoginAndOptCodeFill();
  const withScrape = withFill.withScraper(stubScrape);
  return withScrape.build();
}

/**
 * Build a browser-driven (non-headless) descriptor.
 * @param opts - Scraper options to seed the builder.
 * @returns Pipeline descriptor Procedure.
 */
function buildBrowserDescriptor(opts: ScraperOptions): Procedure<IPipelineDescriptor> {
  const builder = createPipelineBuilder();
  const seeded = builder.withOptions(opts);
  const withBrowser = seeded.withBrowser();
  const withLogin = withBrowser.withNativeLogin(stubLogin);
  const withScrape = withLogin.withScraper(stubScrape);
  return withScrape.build();
}

describe('PipelineBuilder — withHeadlessMediator', () => {
  it('returns success Procedure for a headless native-login build', () => {
    const opts = makeMockOptions();
    const result = buildHeadlessDescriptor(opts);
    assertOk(result);
  });

  it('descriptor carries isHeadless=true when withHeadlessMediator() is used', () => {
    const opts = makeMockOptions();
    const result = buildHeadlessDescriptor(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(true);
  });

  it('phase list EXCLUDES init/home/pre-login/dashboard/terminate', () => {
    const opts = makeMockOptions();
    const result = buildHeadlessDescriptor(opts);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).not.toContain('init');
    expect(names).not.toContain('home');
    expect(names).not.toContain('pre-login');
    expect(names).not.toContain('dashboard');
    expect(names).not.toContain('terminate');
  });

  it('phase list INCLUDES login + scrape (native + scraper wired)', () => {
    const opts = makeMockOptions();
    const result = buildHeadlessDescriptor(opts);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).toContain('login');
    expect(names).toContain('scrape');
  });

  it('phase list INCLUDES otp-trigger + otp-fill when OTP chain is added', () => {
    const opts = makeMockOptions();
    const result = buildHeadlessOtpDescriptor(opts);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).toContain('otp-trigger');
    expect(names).toContain('otp-fill');
  });

  it('interceptors are empty for headless builds (no popup interceptor)', () => {
    const opts = makeMockOptions();
    const result = buildHeadlessDescriptor(opts);
    assertOk(result);
    expect(result.value.interceptors).toHaveLength(0);
  });
});

describe('PipelineBuilder — back-compat (no withHeadlessMediator)', () => {
  it('browser-driven build still produces success Procedure', () => {
    const opts = makeMockOptions();
    const result = buildBrowserDescriptor(opts);
    assertOk(result);
  });

  it('descriptor carries isHeadless=false when withHeadlessMediator() is omitted', () => {
    const opts = makeMockOptions();
    const result = buildBrowserDescriptor(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(false);
  });

  it('browser-driven phase list INCLUDES init/home/pre-login/terminate', () => {
    const opts = makeMockOptions();
    const result = buildBrowserDescriptor(opts);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).toContain('init');
    expect(names).toContain('home');
    expect(names).toContain('pre-login');
    expect(names).toContain('terminate');
  });

  it('browser-driven build attaches the popup interceptor', () => {
    const opts = makeMockOptions();
    const result = buildBrowserDescriptor(opts);
    assertOk(result);
    expect(result.value.interceptors.length).toBeGreaterThan(0);
  });
});
