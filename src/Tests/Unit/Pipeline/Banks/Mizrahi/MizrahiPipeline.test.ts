/**
 * Unit tests for the Mizrahi pipeline factory.
 * Pins the browserless chain: the config-driven API-DIRECT-CALL login, then
 * the shape-driven API-DIRECT-SCRAPE — no browser phase, no interceptor.
 * `build()` validates the call config against Mizrahi's headless block, so a
 * success also proves the config is well-formed.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { buildMizrahiPipeline } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/MizrahiPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

/** Options naming Mizrahi, so the builder checks Mizrahi's headless entry. */
const MIZRAHI_OPTIONS = { companyId: CompanyTypes.Mizrahi } as const;

/** API-direct login + hard-model scrape — nothing else runs. */
const API_DIRECT_PHASES = ['api-direct-call', 'api-direct-scrape'] as const;

describe('buildMizrahiPipeline', () => {
  it('returns a success Procedure that preserves the options', () => {
    const opts = makeMockOptions(MIZRAHI_OPTIONS);
    const result = buildMizrahiPipeline(opts);
    assertOk(result);
    expect(result.value.options).toBe(opts);
  });

  it('is a headless pipeline', () => {
    const opts = makeMockOptions(MIZRAHI_OPTIONS);
    const result = buildMizrahiPipeline(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(true);
  });

  it('runs only the API-direct login and scrape', () => {
    const opts = makeMockOptions(MIZRAHI_OPTIONS);
    const result = buildMizrahiPipeline(opts);
    assertOk(result);
    const names = result.value.phases.map((p): string => p.name);
    expect(names).toEqual(API_DIRECT_PHASES);
  });
});
