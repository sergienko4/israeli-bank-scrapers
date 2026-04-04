/**
 * Account bootstrapping — Content-First SessionStorage Harvester.
 * Scans ALL frame sessionStorages for WK.accountId fields.
 * Generic for ALL SPAs — no hardcoded key names, no direct API calls.
 * All discovery via mediator + WK field signatures.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { extractAccountIds, extractAccountRecords } from './ScrapeAutoMapper.js';

const LOG = getDebug('account-bootstrap');

/** Raw JSON string from sessionStorage. */
type StorageValue = string;
/** Whether a storage value starts with '{'. */
type IsJsonLike = boolean;

/** Bootstrapped account IDs + records. */
interface IBootstrapResult {
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
}

/** Empty bootstrap result. */
const EMPTY_BOOTSTRAP: IBootstrapResult = { ids: [], records: [] };

/** Max time to wait for SPA to populate sessionStorage (ms). */
const HARVEST_TIMEOUT = 10_000;

/**
 * Read all JSON-like sessionStorage values from a frame.
 * @param frame - Playwright frame.
 * @returns Array of JSON strings.
 */
async function readAllJsonValues(frame: Frame): Promise<readonly string[]> {
  return frame
    .evaluate((): StorageValue[] =>
      Object.keys(sessionStorage)
        .map((k): StorageValue => sessionStorage.getItem(k) ?? '')
        .filter((v): IsJsonLike => v.startsWith('{')),
    )
    .catch((): StorageValue[] => []);
}

/**
 * Try parsing a JSON string and extracting account IDs via WK.
 * @param raw - Raw JSON string from sessionStorage.
 * @returns Bootstrap result or false.
 */
/**
 * Parse JSON and extract accounts. Returns false if no IDs found.
 * @param body - Parsed JSON.
 * @returns Result or false.
 */
function extractFromBody(body: Record<string, unknown>): IBootstrapResult | false {
  const ids = extractAccountIds(body);
  if (ids.length === 0) return false;
  const records = extractAccountRecords(body);
  return { ids, records };
}

/**
 * Try parsing a JSON string and extracting account IDs via WK.
 * @param raw - Raw JSON string from sessionStorage.
 * @returns Bootstrap result or false.
 */
function tryExtractAccounts(raw: StorageValue): IBootstrapResult | false {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    return extractFromBody(body);
  } catch {
    return false;
  }
}

/**
 * Scan one frame for account data in sessionStorage.
 * @param frame - Playwright frame.
 * @returns Bootstrap result or false.
 */
async function scanFrame(frame: Frame): Promise<IBootstrapResult | false> {
  const values = await readAllJsonValues(frame);
  const matchVal = values.find((v): IsJsonLike => tryExtractAccounts(v) !== false);
  if (!matchVal) return false;
  return tryExtractAccounts(matchVal);
}

/**
 * Single pass: scan all frames for account data.
 * @param page - Playwright page.
 * @returns Bootstrap result or false.
 */
async function scanAllFrames(page: Page): Promise<IBootstrapResult | false> {
  const frames = page.frames();
  const scanPromises = frames.map(scanFrame);
  const results = await Promise.allSettled(scanPromises);
  const hit = results.find((r): IsJsonLike => r.status === 'fulfilled' && r.value !== false);
  if (hit?.status !== 'fulfilled') return false;
  return hit.value || false;
}

/**
 * Content-First: harvest account IDs from ALL frame sessionStorages.
 * Uses Playwright waitForFunction to poll — no manual setTimeout.
 * @param page - Playwright page with attached frames.
 * @returns Bootstrapped IDs + records, or empty.
 */
async function harvestAccountsFromStorage(page: Page): Promise<IBootstrapResult> {
  LOG.debug({
    event: 'generic-trace',
    phase: 'SCRAPE',
    message: 'Harvesting accounts from sessionStorage',
  });
  const immediate = await scanAllFrames(page);
  if (immediate) {
    const count = String(immediate.ids.length);
    LOG.debug({
      event: 'generic-trace',
      phase: 'SCRAPE',
      message: `Storage harvest: ${count} accounts found`,
    });
    return immediate;
  }
  // Wait for SPA to populate — use waitForFunction on each frame
  const frames = page.frames();
  const waiters = frames.map(
    (frame): Promise<string> =>
      frame
        .waitForFunction(
          (): StorageValue => {
            const vals = Object.keys(sessionStorage)
              .map((k): StorageValue => sessionStorage.getItem(k) ?? '')
              .filter((v): IsJsonLike => v.includes('cardUniqueId') || v.includes('accountId'));
            return vals[0] || '';
          },
          { timeout: HARVEST_TIMEOUT, polling: 500 },
        )
        .then(async (h): Promise<string> => {
          const val = await h.jsonValue();
          return val || '';
        })
        .catch((): StorageValue => ''),
  );
  const waited = await Promise.allSettled(waiters);
  const nonEmpty = waited
    .filter((r): IsJsonLike => r.status === 'fulfilled' && r.value.length > 0)
    .map((r): StorageValue => (r as PromiseFulfilledResult<StorageValue>).value);
  const matchVal = nonEmpty.find((v): IsJsonLike => tryExtractAccounts(v) !== false);
  if (!matchVal) {
    LOG.debug({
      event: 'generic-trace',
      phase: 'SCRAPE',
      message: 'Storage harvest: 0 accounts found',
    });
    return EMPTY_BOOTSTRAP;
  }
  const result = tryExtractAccounts(matchVal);
  if (!result) return EMPTY_BOOTSTRAP;
  const count = String(result.ids.length);
  LOG.debug({
    event: 'generic-trace',
    phase: 'SCRAPE',
    message: `Storage harvest: ${count} accounts found (polled)`,
  });
  return result;
}

export type { IBootstrapResult };
export { harvestAccountsFromStorage };
