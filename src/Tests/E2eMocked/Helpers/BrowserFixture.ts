import { type Browser } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

/** Stealth plugin instance for WAF bypass. */
const STEALTH_PLUGIN = StealthPlugin();
chromium.use(STEALTH_PLUGIN);

let sharedBrowser: Browser | null = null;

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
];

/**
 * Returns the shared Playwright browser instance, launching it if not already started.
 *
 * @returns the shared Browser instance
 */
export async function getSharedBrowser(): Promise<Browser> {
  sharedBrowser ??= await chromium.launch({ headless: true, args: BROWSER_ARGS });
  return sharedBrowser;
}

/**
 * Closes the shared browser and resets the singleton to null.
 */
export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
