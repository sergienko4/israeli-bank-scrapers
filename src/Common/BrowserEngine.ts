import type { Browser } from 'playwright';

/** Selects which browser driver is used for scraping. */
export enum BrowserEngineType {
  /** donutbrowser-camoufox-js — Firefox with C++-level stealth; addInitScript runs in isolated world (Engine 1, default). */
  Camoufox = 'camoufox',
  /** playwright-extra + puppeteer-extra-plugin-stealth (Engine 2). */
  PlaywrightStealth = 'playwright-stealth',
  /** rebrowser-playwright — rebrowser patches applied at runtime (Engine 3). */
  Rebrowser = 'rebrowser',
  /** patchright — Microsoft fork with CDP-level bot-detection bypass (Engine 4). */
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
 * Launches a Firefox browser via donutbrowser-camoufox-js.
 * page.evaluate() runs in the main world (cookies visible).
 * context.addInitScript() runs in an isolated world — applyStealthPatches() must be skipped for this engine.
 *
 * @param opts - browser launch options forwarded to Camoufox()
 * @returns a launched Browser instance compatible with the Playwright Browser API
 */
async function launchCamoufox(opts: LaunchEngineOptions): Promise<Browser> {
  const { Camoufox } = await import('donutbrowser-camoufox-js');
  return Camoufox({ headless: opts.headless }) as unknown as Browser;
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
    [BrowserEngineType.Camoufox]: launchCamoufox,
    [BrowserEngineType.PlaywrightStealth]: launchPlaywrightStealth,
    [BrowserEngineType.Rebrowser]: launchRebrowser,
    [BrowserEngineType.Patchright]: launchPatchright,
  };

/**
 * Returns true when the engine supports context.addInitScript() in the main world.
 * Camoufox runs addInitScript() in an isolated world, so applyStealthPatches() must be skipped.
 *
 * @param engineType - the browser engine type to check
 * @returns false for Camoufox; true for all other engines
 */
export function isCapableOfInitScript(engineType: BrowserEngineType): boolean {
  return engineType !== BrowserEngineType.Camoufox;
}

/**
 * Module-level mutable global engine chain.
 * Camoufox is NOT included by default — it requires a separate binary install:
 *   npx donutbrowser-camoufox-js fetch
 * Add it via setGlobalEngineChain([BrowserEngineType.Camoufox, ...]) after installing.
 */
let globalEngineChain: BrowserEngineType[] = [
  BrowserEngineType.PlaywrightStealth,
  BrowserEngineType.Rebrowser,
  BrowserEngineType.Patchright,
];

/**
 * Returns the current global engine fallback chain.
 *
 * @returns the ordered list of engine types tried by ScraperWithFallback by default
 */
export function getGlobalEngineChain(): BrowserEngineType[] {
  return globalEngineChain;
}

/**
 * Replaces the global engine fallback chain with the given list.
 * All subsequent ScraperWithFallback instances (using the default) will use this chain.
 *
 * @param engines - the new ordered list of engine types
 */
export function setGlobalEngineChain(engines: BrowserEngineType[]): void {
  globalEngineChain = engines;
}

/**
 * Sets the global engine chain to a single engine (no fallback).
 * Equivalent to setGlobalEngineChain([engine]).
 *
 * @param engine - the single engine type to use
 */
export function setGlobalDefaultEngine(engine: BrowserEngineType): void {
  globalEngineChain = [engine];
}

/**
 * Launches a browser using the specified engine driver.
 * All engines expose the same Playwright Browser API so context creation is identical.
 *
 * @param type - which engine to use (Camoufox | PlaywrightStealth | Rebrowser | Patchright)
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
