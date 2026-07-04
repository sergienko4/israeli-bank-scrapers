/**
 * AuthDiscovery storage-tier chain — the page-only sessionStorage discovery
 * shared by the full orchestrator (Tier 2..4) and the BIND-API-MEDIATOR
 * auth-prime. Single-sourced so both paths find frame-scoped SPA tokens
 * identically (main page → all frames → all keys).
 */

import type { Page } from 'playwright-core';

import { discoverFromAllFrames } from './StorageFrames.js';
import { discoverFromStorage } from './StorageMain.js';
import { discoverFromAllStorageKeys } from './StorageScanAll.js';

/**
 * Try the three sessionStorage tiers in order: main-page (3a), all-frame
 * well-known keys (3b), then all-frame all-keys JSON scan (3c).
 * @param page - Playwright page.
 * @returns Token or false.
 */
export async function storageTiers(page: Page): Promise<string | false> {
  const fromStorage = await discoverFromStorage(page);
  if (fromStorage) return fromStorage;
  const fromFrames = await discoverFromAllFrames(page);
  if (fromFrames) return fromFrames;
  return discoverFromAllStorageKeys(page);
}

export default storageTiers;
