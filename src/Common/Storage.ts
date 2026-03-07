import { type Page } from 'playwright';

import type { StorageResult } from '../Interfaces/Common/StorageResult';

/**
 * Retrieves and JSON-parses a value from the browser's sessionStorage using the given key.
 * Returns a StorageResult with hasValue: false when the key is absent or the page context
 * is unavailable during navigation.
 *
 * @param page - the Playwright Page whose sessionStorage should be read
 * @param key - the sessionStorage key to retrieve
 * @returns a StorageResult wrapping the parsed value, or hasValue: false when the key is missing
 */
export async function getFromSessionStorage<T>(page: Page, key: string): Promise<StorageResult<T>> {
  try {
    const strData = await page.evaluate((k: string) => sessionStorage.getItem(k), key);
    if (!strData) return { hasValue: false };
    return { hasValue: true, value: JSON.parse(strData) as T };
  } catch {
    return { hasValue: false }; // page navigating or context destroyed — caller retries via waitUntil
  }
}

export default getFromSessionStorage;
