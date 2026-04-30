/**
 * TokenCache — test-only helper that persists a bank's long-term OTP
 * token to `<os.tmpdir()>/<bank>-token.cache` across real-E2E runs.
 *
 * Usage:
 *   const cache = createTokenCache({
 *     bankKey: 'onezero',
 *     envFlag: 'ONEZERO_OTP_LONG_TERM',
 *     log,
 *   });
 *   const cached = await cache.read();         // '' when disabled or miss
 *   // build creds with (cached.length > 0 ? warm : cold)
 *   const result = await scraper.scrape(creds);
 *   // cache.writer is bound to ScraperOptions.onAuthFlowComplete
 *
 * The env flag is presence-only: any nonempty value enables caching;
 * the value itself is never read as a token. The actual token comes
 * via ScraperOptions.onAuthFlowComplete and is written atomically.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IAuthFlowInfo } from '../../Scrapers/Base/Interface.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Types/Debug.js';

/** Supported bank keys — matches the BankPlugin taxonomy. */
type BankKey = 'onezero' | 'pepper';

/** Args bundle for createTokenCache — respects the 3-param ceiling. */
interface ITokenCacheArgs {
  readonly bankKey: BankKey;
  readonly envFlag: string;
  readonly log: ScraperLogger;
}

/** Public handle returned by createTokenCache. */
interface ITokenCacheHandle {
  readonly enabled: boolean;
  read: () => Promise<string>;
  write: (token: string) => Promise<boolean>;
  readonly writer: (info: IAuthFlowInfo) => Promise<void>;
}

/**
 * Resolve the cache file path for a bank.
 * @param bankKey - One of the BankKey union values.
 * @returns Absolute path to <tmpdir>/<bank>-token.cache.
 */
function cachePathFor(bankKey: BankKey): string {
  const tmp = os.tmpdir();
  return path.join(tmp, `${bankKey}-token.cache`);
}

/**
 * Safely read the cache file. Returns '' on missing, empty, or any
 * read error (permissions, corruption).
 * @param cachePath - Absolute path.
 * @param log - Logger for WARN-level diagnostics.
 * @returns Trimmed token string or ''.
 */
async function readCacheSafe(cachePath: string, log: ScraperLogger): Promise<string> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    return raw.trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return '';
    log.warn({ cachePath, code: e.code ?? 'UNKNOWN' }, 'TokenCache read failure');
    return '';
  }
}

/**
 * Safely write the cache file (UTF-8, truncating any prior content).
 * Returns false on any write error (permissions, full disk).
 * @param cachePath - Absolute path.
 * @param token - Token string.
 * @param log - Logger for WARN diagnostics.
 * @returns True on success, false on failure.
 */
async function writeCacheSafe(
  cachePath: string,
  token: string,
  log: ScraperLogger,
): Promise<boolean> {
  try {
    await fs.writeFile(cachePath, token, { encoding: 'utf8' });
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    log.warn({ cachePath, code: e.code ?? 'UNKNOWN' }, 'TokenCache write failure');
    return false;
  }
}

/**
 * Build the ScraperOptions.onAuthFlowComplete writer bound to the
 * cache. Callback is safe to pass verbatim; throws are captured by
 * the mediator-side invoker.
 * @param cachePath - Absolute path.
 * @param log - Logger for info/warn diagnostics.
 * @returns Async writer.
 */
function buildWriter(
  cachePath: string,
  log: ScraperLogger,
): (info: IAuthFlowInfo) => Promise<void> {
  return async (info: IAuthFlowInfo): Promise<void> => {
    if (info.longTermToken.length === 0) {
      // No token present — nothing to persist.
    } else {
      const isWritten = await writeCacheSafe(cachePath, info.longTermToken, log);
      if (isWritten) {
        log.info({ cachePath, tokenLength: info.longTermToken.length }, 'TokenCache updated');
      }
    }
  };
}

/**
 * Disabled-cache read — resolves to ''.
 * @returns Empty string Promise.
 */
function noopRead(): Promise<string> {
  return Promise.resolve('');
}

/**
 * Disabled-cache write — resolves to false.
 * @returns False Promise.
 */
function noopWrite(): Promise<boolean> {
  return Promise.resolve(false);
}

/**
 * Disabled-cache writer — resolves to undefined.
 * @returns Void Promise.
 */
function noopWriter(): Promise<void> {
  return Promise.resolve();
}

/**
 * Create a disabled (no-op) cache handle used when the env flag is
 * unset. All operations return '' / false / no-op writer.
 * @returns No-op cache handle.
 */
function createDisabledCache(): ITokenCacheHandle {
  return { enabled: false, read: noopRead, write: noopWrite, writer: noopWriter };
}

/**
 * Build a per-bank token cache handle. When the env flag is unset,
 * returns a no-op cache. When set, reads/writes
 * <tmpdir>/<bankKey>-token.cache.
 * @param args - Bank key + env flag + logger.
 * @returns Cache handle.
 */
function createTokenCache(args: ITokenCacheArgs): ITokenCacheHandle {
  const flag = process.env[args.envFlag];
  if (flag === undefined || flag.length === 0) return createDisabledCache();
  const cachePath = cachePathFor(args.bankKey);
  const log = args.log;
  /**
   * Read the cached token.
   * @returns Trimmed token or ''.
   */
  const read = (): Promise<string> => readCacheSafe(cachePath, log);
  /**
   * Write a token to the cache. No-op when token is empty.
   * @param token - Token to persist.
   * @returns True on write, false on skip/error.
   */
  const write = async (token: string): Promise<boolean> => {
    if (token.length === 0) return false;
    return writeCacheSafe(cachePath, token, log);
  };
  const writer = buildWriter(cachePath, log);
  return { enabled: true, read, write, writer };
}

export type { BankKey, ITokenCacheArgs, ITokenCacheHandle };
export { createTokenCache };
