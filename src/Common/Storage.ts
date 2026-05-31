import { type Page } from 'playwright-core';

/** Nullable result from session storage lookup — matches browser API semantics. */
type NullableStorageResult<T> = Promise<T | null>;

/** Sentinel value for empty storage results (internal type alias). */
export const STORAGE_EMPTY = null;

/**
 * Read and parse a JSON value from the browser's sessionStorage.
 * Returns null when the key is missing or parsing fails — callers poll via waitUntil.
 * @param page - The Playwright page to evaluate in.
 * @param key - The sessionStorage key to read.
 * @returns The parsed value or null if not found.
 */
export async function getFromSessionStorage<T>(page: Page, key: string): NullableStorageResult<T> {
  try {
    const strData = await page.evaluate(
      (storageKey: string) => sessionStorage.getItem(storageKey),
      key,
    );
    if (!strData) return STORAGE_EMPTY;
    return JSON.parse(strData) as T;
  } catch {
    return STORAGE_EMPTY;
  }
}
