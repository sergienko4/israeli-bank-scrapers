import { type Page } from 'playwright';

export async function getFromSessionStorage<T>(page: Page, key: string): Promise<T | null> {
  try {
    const strData = await page.evaluate((k: string) => sessionStorage.getItem(k), key);
    if (!strData) return null;
    return JSON.parse(strData) as T;
  } catch {
    return null; // page navigating or context destroyed — caller retries via waitUntil
  }
}
