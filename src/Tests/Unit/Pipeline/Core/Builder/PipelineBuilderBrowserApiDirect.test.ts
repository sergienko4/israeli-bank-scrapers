/**
 * Unit tests for PipelineBuilder — withBrowserApiDirect branch.
 * Verifies that a BROWSER bank migrated to the hard-model post-auth
 * path keeps its browser login phases (INIT / HOME / LOGIN /
 * TERMINATE) yet drops the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE /
 * DASHBOARD / BALANCE-RESOLVE chain in favour of BIND-API-MEDIATOR +
 * the single API-DIRECT-SCRAPE phase — while staying non-headless.
 */

import type { ScraperOptions } from '../../../../../Scrapers/Base/Interface.js';
import { createPipelineBuilder } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import {
  makeMockOptions,
  MOCK_API_DIRECT_SHAPE,
  MOCK_LOGIN_CONFIG,
} from '../../Infrastructure/MockFactories.js';

/**
 * Build a browser bank migrated to the hard-model post-auth path.
 * @param opts - Scraper options to seed the builder.
 * @returns Pipeline descriptor Procedure.
 */
function buildBrowserApiDirectDescriptor(opts: ScraperOptions): Procedure<IPipelineDescriptor> {
  const builder = createPipelineBuilder();
  const seeded = builder.withOptions(opts);
  const withBrowser = seeded.withBrowser();
  const withLogin = withBrowser.withDeclarativeLogin(MOCK_LOGIN_CONFIG);
  const migrated = withLogin.withBrowserApiDirect(MOCK_API_DIRECT_SHAPE);
  return migrated.build();
}

/**
 * Assemble a migrated descriptor and project its phase names.
 * @param opts - Scraper options to seed the builder.
 * @returns Ordered phase-name list.
 */
function migratedPhaseNames(opts: ScraperOptions): readonly string[] {
  const result = buildBrowserApiDirectDescriptor(opts);
  assertOk(result);
  return result.value.phases.map((p): string => p.name);
}

describe('PipelineBuilder — withBrowserApiDirect', () => {
  it('returns a success Procedure for a migrated browser bank', () => {
    const opts = makeMockOptions();
    const result = buildBrowserApiDirectDescriptor(opts);
    expect(result.success).toBe(true);
    assertOk(result);
  });

  it('keeps browser login + terminate phases (isHeadless stays false)', () => {
    const opts = makeMockOptions();
    const result = buildBrowserApiDirectDescriptor(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(false);
    const names = result.value.phases.map((p): string => p.name);
    expect(names).toContain('init');
    expect(names).toContain('home');
    expect(names).toContain('login');
    expect(names).toContain('terminate');
  });

  it('replaces the generic middle phases with bind-api-mediator + api-direct-scrape', () => {
    const opts = makeMockOptions();
    const names = migratedPhaseNames(opts);
    expect(names).toContain('bind-api-mediator');
    expect(names).toContain('api-direct-scrape');
    expect(names).toContain('auth-discovery');
    expect(names).not.toContain('account-resolve');
    expect(names).not.toContain('dashboard');
    expect(names).not.toContain('balance-resolve');
    expect(names).not.toContain('scrape');
  });

  it('orders bind-api-mediator immediately before api-direct-scrape', () => {
    const opts = makeMockOptions();
    const names = migratedPhaseNames(opts);
    const bindIdx = names.indexOf('bind-api-mediator');
    const scrapeIdx = names.indexOf('api-direct-scrape');
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(scrapeIdx).toBe(bindIdx + 1);
  });
});
