/**
 * Shared test factories for SCRAPE.post + detection-branch tests.
 *
 * <p>Extracted from `ScrapePhaseActionsWave5.test.ts` and
 * `ScrapePostDetectionBranches.test.ts` to keep one contract source
 * across the suites (per mocking-test-guidlines: "Prefer helper /
 * builders / factories over global setup/teardown" + CLAUDE.md
 * "Use factory functions for test mocks ... no duplication").
 */

import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IAccountDiscovery } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/**
 * Build a mediator whose `network.getAllEndpoints` returns the
 * supplied pool. Used by SCRAPE.post detection tests across both
 * test files; centralised here so the discovery shape doesn't drift.
 *
 * @param pool - Pool to expose via the mediator stub.
 * @returns Mediator with patched network.
 */
export function makeMediatorWithPool(
  pool: readonly IDiscoveredEndpoint[],
): ReturnType<typeof makeMockMediator> {
  const base = makeMockMediator();
  return {
    ...base,
    network: {
      ...base.network,
      /**
       * Returns the seeded pool.
       *
       * @returns Pool.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => pool,
    },
  };
}

/**
 * Build an accountDiscovery option with a single id + record pair.
 * Used by SCRAPE.post emit tests that exercise buildAccountIdentities.
 *
 * @param id - iter accountId.
 * @param record - matching record.
 * @returns accountDiscovery Some.
 */
export function makeSingleAccountDiscovery(
  id: string,
  record: Record<string, unknown>,
): ReturnType<typeof some<IAccountDiscovery>> {
  const discovery: IAccountDiscovery = {
    ids: [id],
    records: [record],
    containers: {},
    endpointCaptureIndex: 0,
  };
  return some(discovery);
}
