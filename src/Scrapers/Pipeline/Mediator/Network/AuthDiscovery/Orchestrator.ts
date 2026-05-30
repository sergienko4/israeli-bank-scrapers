/**
 * AuthDiscovery orchestrator — 5-tier discovery with short-circuit.
 *
 * Order of attempts:
 *   1. Response bodies (Tier 2)
 *   2. Main-page sessionStorage (Tier 3a)
 *   3. ALL iframe sessionStorages (Tier 3b)
 *   4. Scan all storage keys (Tier 3c)
 *   5. Request headers (Tier 1)
 *   6. Poll auth-module (Tier 4)
 */

import type { Page } from 'playwright-core';

import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import { discoverFromHeaders } from './HeadersTier.js';
import { pollForAuthModule } from './PollTier.js';
import { discoverFromResponses } from './ResponseTier.js';
import { discoverFromAllFrames } from './StorageFrames.js';
import { discoverFromStorage } from './StorageMain.js';
import { discoverFromAllStorageKeys } from './StorageScanAll.js';

/**
 * Try the three sessionStorage tiers in order.
 * @param page - Playwright page.
 * @returns Token or false.
 */
async function storageTiers(page: Page): Promise<string | false> {
  const fromStorage = await discoverFromStorage(page);
  if (fromStorage) return fromStorage;
  const fromFrames = await discoverFromAllFrames(page);
  if (fromFrames) return fromFrames;
  return discoverFromAllStorageKeys(page);
}

/**
 * Try the request-header + poll tiers after storage tiers fail.
 * @param captured - Captured endpoints.
 * @param page - Playwright page.
 * @returns Token or false.
 */
async function fallbackTiers(
  captured: readonly IDiscoveredEndpoint[],
  page: Page,
): Promise<string | false> {
  const fromHeaders = discoverFromHeaders(captured);
  if (fromHeaders) return fromHeaders;
  return pollForAuthModule(page);
}

/**
 * Discover auth token across all 5 tiers.
 * @param captured - Captured endpoints.
 * @param page - Playwright page.
 * @returns Auth token or false.
 */
async function discoverAuthThreeTier(
  captured: readonly IDiscoveredEndpoint[],
  page: Page,
): Promise<string | false> {
  const fromBody = discoverFromResponses(captured);
  if (fromBody) return fromBody;
  const fromStorage = await storageTiers(page);
  if (fromStorage) return fromStorage;
  return fallbackTiers(captured, page);
}

export default discoverAuthThreeTier;
