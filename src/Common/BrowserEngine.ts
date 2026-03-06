import type { Browser } from 'playwright';

/** Selects which Chromium browser driver is used for scraping. */
export enum BrowserEngineType {
  /** playwright-extra + puppeteer-extra-plugin-stealth (Engine 1, default). */
  PlaywrightStealth = 'playwright-stealth',
  /** rebrowser-playwright — rebrowser patches applied at runtime (Engine 2). */
  Rebrowser = 'rebrowser',
  /** patchright — Microsoft fork with CDP-level bot-detection bypass (Engine 3). */
  Patchright = 'patchright',
}

/** Options forwarded to the underlying browser launch call. */
export interface LaunchEngineOptions {
  headless?: boolean;
  args?: string[];
  timeout?: number;
  executablePath?: string;
}

/**
 * Launches a browser via playwright-extra with the puppeteer-stealth plugin applied.
 *
 * @param opts - browser launch options forwarded to chromium.launch()
 * @returns a launched Browser instance
 */
async function launchPlaywrightStealth(opts: LaunchEngineOptions): Promise<Browser> {
  const { chromium } = await import('playwright-extra');
  const stealthPluginFactory = (await import('puppeteer-extra-plugin-stealth')).default;
  const stealthPlugin = stealthPluginFactory();
  chromium.use(stealthPlugin);
  return chromium.launch(opts);
}

/**
 * Launches a browser via rebrowser-playwright with rebrowser patches applied.
 *
 * @param opts - browser launch options forwarded to chromium.launch()
 * @returns a launched Browser instance
 */
async function launchRebrowser(opts: LaunchEngineOptions): Promise<Browser> {
  const { chromium } = await import('rebrowser-playwright');
  return (await chromium.launch(opts)) as unknown as Browser;
}

/**
 * Launches a browser via patchright (CDP-level bot-detection bypass).
 *
 * @param opts - browser launch options forwarded to chromium.launch()
 * @returns a launched Browser instance
 */
async function launchPatchright(opts: LaunchEngineOptions): Promise<Browser> {
  const { chromium } = await import('patchright');
  return (await chromium.launch(opts)) as unknown as Browser;
}

/** Maps each engine type to its launch implementation. */
const ENGINE_LAUNCHERS: Record<BrowserEngineType, (opts: LaunchEngineOptions) => Promise<Browser>> =
  {
    [BrowserEngineType.PlaywrightStealth]: launchPlaywrightStealth,
    [BrowserEngineType.Rebrowser]: launchRebrowser,
    [BrowserEngineType.Patchright]: launchPatchright,
  };

/**
 * Launches a Chromium browser using the specified engine driver.
 * All engines expose the same Playwright Browser API so context creation is identical.
 *
 * @param type - which engine to use (PlaywrightStealth | Rebrowser | Patchright)
 * @param opts - browser launch options (headless, args, timeout, executablePath)
 * @returns a Browser instance from the chosen engine
 */
export async function launchWithEngine(
  type: BrowserEngineType,
  opts: LaunchEngineOptions,
): Promise<Browser> {
  const launcher = ENGINE_LAUNCHERS[type];
  return launcher(opts);
}
