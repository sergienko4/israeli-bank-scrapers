/**
 * Unit tests for the Mizrahi pipeline factory.
 * Pins the HTTP-only chain: the config-driven API-DIRECT-CALL login, then
 * the shape-driven API-DIRECT-SCRAPE.
 * `build()` validates the call config against Mizrahi's transport block, so a
 * success also proves the config is well-formed.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';
import { factoryOf } from '../PipelineRegistryTestHelpers.js';

const BUILD_MIZRAHI = factoryOf(CompanyTypes.Mizrahi);

/** Options naming Mizrahi, so the builder checks Mizrahi's transport entry. */
const MIZRAHI_OPTIONS = { companyId: CompanyTypes.Mizrahi } as const;

/** API-direct login + hard-model scrape — nothing else runs. */
const API_DIRECT_PHASES = ['api-direct-call', 'api-direct-scrape'] as const;

describe('BUILD_MIZRAHI', () => {
  it('returns a success Procedure that preserves the options', () => {
    const opts = makeMockOptions(MIZRAHI_OPTIONS);
    const result = BUILD_MIZRAHI(opts);
    assertOk(result);
    expect(result.value.options).toBe(opts);
  });

  it('runs only the API-direct login and scrape', () => {
    const opts = makeMockOptions(MIZRAHI_OPTIONS);
    const result = BUILD_MIZRAHI(opts);
    assertOk(result);
    const names = result.value.phases.map((p): string => p.name);
    expect(names).toEqual(API_DIRECT_PHASES);
  });
});
