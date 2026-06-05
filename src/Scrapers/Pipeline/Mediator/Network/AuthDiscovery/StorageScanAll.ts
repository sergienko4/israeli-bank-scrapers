/**
 * AuthDiscovery Tier 3c — scan ALL sessionStorage keys across all frames
 * for JSON-shaped token values. Generic: no key name assumptions.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { tryParseJsonToken } from './Tokens.js';

const LOG = getDebug(import.meta.url);

/** Max chars of a frame URL surfaced in token-scan trace diagnostics. */
const FRAME_URL_PREVIEW_LEN = 40;

/**
 * Read every sessionStorage value in a frame that looks like JSON.
 * @param frame - Playwright frame.
 * @returns Array of JSON strings.
 */
export async function readAllJsonStorageValues(frame: Frame): Promise<readonly string[]> {
  return frame
    .evaluate((): string[] =>
      Object.keys(sessionStorage)
        .map((k): string => sessionStorage.getItem(k) ?? '')
        .filter((v): boolean => v.startsWith('{')),
    )
    .catch((): string[] => []);
}

/**
 * Scan all sessionStorage keys in a frame for token-like JSON values.
 * @param frame - Playwright frame.
 * @returns Token or false.
 */
async function scanFrameForTokens(frame: Frame): Promise<string | false> {
  const allValues = await readAllJsonStorageValues(frame);
  const tokenVal = allValues.find((v): boolean => tryParseJsonToken(v) !== false);
  if (!tokenVal) return false;
  const framePreview = frame.url().slice(0, FRAME_URL_PREVIEW_LEN);
  LOG.trace({ message: maskVisibleText(`Tier3c: token from frame ${framePreview}`) });
  return tryParseJsonToken(tokenVal);
}

/**
 * Collect the first valid token returned by any frame scan.
 * @param results - Settled scan results.
 * @returns Token or false.
 */
function firstScanToken(results: readonly PromiseSettledResult<string | false>[]): string | false {
  const tokens = results
    .filter((r): boolean => r.status === 'fulfilled' && r.value !== false)
    .map((r): string => (r as PromiseFulfilledResult<string>).value);
  if (tokens.length === 0) return false;
  return tokens[0];
}

/**
 * Tier 3c: Scan ALL storage keys across all frames for token-like values.
 * @param page - Playwright page.
 * @returns Token or false.
 */
export async function discoverFromAllStorageKeys(page: Page): Promise<string | false> {
  const frames = page.frames();
  const scanPromises = frames.map(scanFrameForTokens);
  const results = await Promise.allSettled(scanPromises);
  return firstScanToken(results);
}
