import { type Browser } from 'playwright-core';

import {
  DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS,
  launchCamoufox,
} from '../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

/** What a first-launch hook does besides the launch, such as starting a loopback server. */
const HOOK_SETUP_SLACK_MS = 10_000;

/**
 * Bound for the hook that takes a job's first Camoufox launch. The install
 * caches only the release asset, so on a fresh machine camoufox-js first
 * fetches uBlock Origin from addons.mozilla.org, retrying a failed fetch.
 * The bound sits above the launcher's default, so a slow launch fails with the
 * launcher's named timeout instead of Jest's generic hook timeout.
 */
export const FIRST_LAUNCH_HOOK_TIMEOUT_MS =
  DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS + HOOK_SETUP_SLACK_MS;

let sharedBrowser: Browser | null = null;

/**
 * E2eMocked tests use Camoufox — same engine as production.
 * @returns The shared browser instance.
 */
export async function getSharedBrowser(): Promise<Browser> {
  sharedBrowser ??= await launchCamoufox(true);
  return sharedBrowser;
}

/**
 * Close the shared browser and reset state.
 * @returns True after browser is closed.
 */
export async function closeSharedBrowser(): Promise<boolean> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
  return true;
}
