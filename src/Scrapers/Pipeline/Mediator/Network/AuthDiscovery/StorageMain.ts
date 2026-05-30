/**
 * AuthDiscovery Tier 3a — read auth token from main-page sessionStorage.
 */

import type { Page } from 'playwright-core';

import { STORAGE_AUTH_KEYS, tryParseJsonToken } from './Tokens.js';

/**
 * Evaluate `sessionStorage.getItem` for each candidate key; return the first non-empty value.
 * @param page - Playwright page.
 * @returns Raw storage value or 'NONE' sentinel.
 */
export async function readMainStorageRaw(page: Page): Promise<string> {
  return page
    .evaluate((keys: string[]): string => {
      const values = keys.map((k): string => sessionStorage.getItem(k) ?? '');
      const found = values.find(Boolean);
      return found ?? 'NONE';
    }, STORAGE_AUTH_KEYS)
    .catch((): string => 'NONE');
}

/**
 * Choose between JSON-parsed token, raw-long-string token, or false.
 * @param raw - Raw storage value.
 * @returns Token or false.
 */
function pickTokenFromRaw(raw: string): string | false {
  if (raw === 'NONE') return false;
  const jsonToken = tryParseJsonToken(raw);
  if (jsonToken) return jsonToken;
  if (raw.length > 10) return raw;
  return false;
}

/**
 * Read auth token from page sessionStorage.
 * @param page - Playwright page.
 * @returns Token string or false.
 */
export async function discoverFromStorage(page: Page): Promise<string | false> {
  const raw = await readMainStorageRaw(page);
  return pickTokenFromRaw(raw);
}
