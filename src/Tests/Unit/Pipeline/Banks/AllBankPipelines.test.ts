/**
 * Unit tests for every bank pipeline factory in the registry.
 * Each factory must produce a success Procedure wrapping a descriptor.
 * Each builder runs under its own bank id, as in production: build-time
 * config rules read that bank's registry entry.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import PIPELINE_REGISTRY from '../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import type { PipelineFactory } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { makeMockOptions } from '../Infrastructure/MockFactories.js';

/** Every public bank id. */
const ALL_BANKS = Object.values(CompanyTypes);

/** Every registered bank and its factory. */
const BANK_BUILDERS: readonly (readonly [CompanyTypes, PipelineFactory])[] = ALL_BANKS.flatMap(
  (companyId): readonly (readonly [CompanyTypes, PipelineFactory])[] => {
    const build = PIPELINE_REGISTRY[companyId];
    return build === undefined ? [] : [[companyId, build]];
  },
);

describe('All bank pipelines', () => {
  it('registers every CompanyTypes member', () => {
    const registered = BANK_BUILDERS.map(([companyId]): CompanyTypes => companyId);
    expect(registered).toHaveLength(ALL_BANKS.length);
  });

  it.each(BANK_BUILDERS)('%s builder returns success Procedure', (companyId, build) => {
    const opts = makeMockOptions({ companyId });
    const result = build(opts);
    expect(result.success).toBe(true);
  });

  it.each(BANK_BUILDERS)('%s descriptor carries options + phases', (companyId, build) => {
    const opts = makeMockOptions({ companyId });
    const result = build(opts);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.options).toBe(opts);
      const isArrayResult3 = Array.isArray(result.value.phases);
      expect(isArrayResult3).toBe(true);
    }
  });
});
