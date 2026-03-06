import { type Page } from 'playwright';

/**
 * Retrieves and JSON-parses a value from the browser's sessionStorage using the given key.
 * Returns null when the key is absent or when the page context is unavailable during navigation.
 *
 * @param page - the Playwright Page whose sessionStorage should be read
 * @param key - the sessionStorage key to retrieve
 * @returns the parsed value typed as T, or null when the key is missing or parsing fails
 */
export async function getFromSessionStorage<T>(page: Page, key: string): Promise<T | null> {
  try {
    const strData = await page.evaluate((k: string) => sessionStorage.getItem(k), key);
    if (!strData) return null;
    return JSON.parse(strData) as T;
  } catch {
    return null; // page navigating or context destroyed — caller retries via waitUntil
  }
}

export default getFromSessionStorage;
