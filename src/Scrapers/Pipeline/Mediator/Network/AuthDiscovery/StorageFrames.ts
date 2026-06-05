/**
 * AuthDiscovery Tier 3b — read auth tokens from ALL frame sessionStorages.
 *
 * Cross-origin iframes store tokens that main page can't see; this tier
 * fans out across every frame in the page.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { prefixToken, STORAGE_AUTH_KEYS, tryParseJsonToken } from './Tokens.js';

const LOG = getDebug(import.meta.url);

/** Minimum length for a raw storage value to be plausibly a GUID/token. */
const STORAGE_TOKEN_MIN_LEN = 20;

/** Max chars of a frame URL surfaced in trace diagnostics. */
const FRAME_URL_PREVIEW_LEN = 50;

/**
 * Try to derive a token from a JSON-shaped storage value.
 * @param raw - Storage value.
 * @returns Token or false.
 */
function tokenFromJsonValue(raw: string): string | false {
  const token = tryParseJsonToken(raw);
  if (token) {
    LOG.trace({ message: 'iframe token found (json)' });
    return token;
  }
  return false;
}

/**
 * Treat a sufficiently-long raw storage value as a GUID/token and prefix it.
 * @param raw - Storage value.
 * @returns Prefixed token or false.
 */
function tokenFromLongRaw(raw: string): string | false {
  if (raw.length <= STORAGE_TOKEN_MIN_LEN) return false;
  const preview = raw.slice(0, STORAGE_TOKEN_MIN_LEN);
  LOG.trace({ message: maskVisibleText(`iframe raw token: ${preview}`) });
  return prefixToken(raw);
}

/**
 * Check a single raw value for a usable token.
 * @param raw - Storage value.
 * @returns Token or false.
 */
export function checkOneValue(raw: string): string | false {
  const jsonHit = tokenFromJsonValue(raw);
  if (jsonHit) return jsonHit;
  const rawHit = tokenFromLongRaw(raw);
  if (rawHit) return rawHit;
  LOG.trace({ message: maskVisibleText(`iframe raw value (short): ${raw}`) });
  return false;
}

/**
 * Extract first valid token from a list of raw storage values.
 * @param values - Non-empty storage values from frames.
 * @returns Prefixed token or false.
 */
function extractFirstToken(values: readonly string[]): string | false {
  const hit = values.find((v): boolean => checkOneValue(v) !== false);
  if (!hit) return false;
  return checkOneValue(hit);
}

/**
 * Read sessionStorage from a single frame.
 * @param frame - Playwright frame.
 * @returns Raw storage value or sentinel.
 */
async function readFrameStorage(frame: Frame): Promise<string> {
  return frame
    .evaluate((keys: readonly string[]): string => {
      const vals = keys.map((k): string => sessionStorage.getItem(k) ?? '');
      return vals.find(Boolean) ?? 'NONE';
    }, STORAGE_AUTH_KEYS)
    .catch((): string => 'NONE');
}

/**
 * Read all sessionStorage key names from a frame for diagnostics.
 * @param frame - Playwright frame.
 * @returns Joined key string.
 */
async function readFrameKeyList(frame: Frame): Promise<string> {
  return frame
    .evaluate((): string => {
      const allKeys = Object.keys(sessionStorage);
      return allKeys.join(', ') || 'EMPTY';
    })
    .catch((): string => 'CROSS-ORIGIN');
}

/**
 * Emit a trace line with the readable sessionStorage keys for one frame.
 * @param frame - Playwright frame.
 * @returns Key list string.
 */
async function dumpFrameKeys(frame: Frame): Promise<string> {
  const keys = await readFrameKeyList(frame);
  const url = frame.url().slice(0, FRAME_URL_PREVIEW_LEN);
  if (keys !== 'EMPTY' && keys !== 'CROSS-ORIGIN') {
    const keyCount = keys.split(', ').length;
    LOG.trace({ url: maskVisibleText(url), keyCount, keysSample: maskVisibleText(keys) });
  }
  return keys;
}

/**
 * Collect resolved storage values from every frame (skip rejected + 'NONE').
 * @param frames - All frames on the page.
 * @returns Non-empty raw storage values.
 */
async function collectFrameStorageValues(frames: readonly Frame[]): Promise<readonly string[]> {
  const storagePromises = frames.map(readFrameStorage);
  const results = await Promise.allSettled(storagePromises);
  return results
    .filter((r): boolean => r.status === 'fulfilled' && r.value !== 'NONE')
    .map((r): string => (r as PromiseFulfilledResult<string>).value);
}

/**
 * Read auth token from sessionStorage of ALL page frames.
 * @param page - Playwright page.
 * @returns Token string or false.
 */
export async function discoverFromAllFrames(page: Page): Promise<string | false> {
  const frames = page.frames();
  const dumpPromises = frames.map(dumpFrameKeys);
  await Promise.allSettled(dumpPromises);
  const values = await collectFrameStorageValues(frames);
  return extractFirstToken(values);
}
