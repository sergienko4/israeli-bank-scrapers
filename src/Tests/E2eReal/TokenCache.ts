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

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IAuthFlowInfo } from '../../Scrapers/Base/Interface.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { replaceAtomically } from './AtomicReplace.js';

/** Supported bank keys — matches the BankPlugin taxonomy. */
type BankKey = 'onezero' | 'pepper' | 'paybox';

/** Args bundle for createTokenCache — respects the 3-param ceiling. */
interface ITokenCacheArgs {
  readonly bankKey: BankKey;
  readonly envFlag: string;
  readonly log: ScraperLogger;
  /**
   * Directory holding the cache file. Defaults to `os.tmpdir()`.
   *
   * <p>Injected rather than read from the ambient environment because
   * `os.tmpdir()` cannot be redirected from inside a test: it resolves
   * `TMPDIR` through `safeGetenv`, which reads the real process environ,
   * while Jest hands each test module a *copy* of `process.env`. A test
   * that overrode `process.env.TMPDIR` therefore still wrote to the shared
   * temp dir and clobbered the developer's real cached token — costing
   * them the very SMS this cache exists to avoid.
   */
  readonly dir?: string;
}

/** Public handle returned by createTokenCache. */
interface ITokenCacheHandle {
  readonly enabled: boolean;
  read: () => Promise<string>;
  write: (token: string) => Promise<boolean>;
  invalidate: () => Promise<boolean>;
  readonly writer: (info: IAuthFlowInfo) => Promise<void>;
}

/**
 * Resolve the cache file path for a bank.
 * @param bankKey - One of the BankKey union values.
 * @param dir - Directory to hold the file; defaults to `os.tmpdir()`.
 * @returns Absolute path to <dir>/<bank>-token.cache.
 */
function cachePathFor(bankKey: BankKey, dir?: string): string {
  const base = dir ?? os.tmpdir();
  return path.join(base, `${bankKey}-token.cache`);
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
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return '';
    log.warn({ cachePath, code: e.code ?? 'UNKNOWN' }, 'TokenCache read failure');
    return '';
  }
}

/** Owner-only file mode for the token cache (Unix rwx for owner, none
 *  for group/other). Mitigates CodeQL js/insecure-temporary-file by
 *  ensuring no other local user can read or hijack the cache. On
 *  Windows this maps to "Full control" for the current user only via
 *  the Node FS layer's mode-bit translation. */
const CACHE_FILE_MODE = 0o600;

/**
 * Write the token into a brand-new owner-only inode.
 *
 * <p>`wx` fails if the path exists, so this never reuses an inode another
 * process may already hold a descriptor for, and the mode is applied at
 * creation rather than tightened afterwards.
 * @param tempPath - Absolute path of the scratch file to create.
 * @param token - Token string.
 * @returns True once the token is written.
 */
async function writeTempOwnerOnly(tempPath: string, token: string): Promise<boolean> {
  const handle = await fs.open(tempPath, 'wx', CACHE_FILE_MODE);
  try {
    await handle.writeFile(token, { encoding: 'utf8' });
    return true;
  } finally {
    await handle.close();
  }
}

/**
 * Remove an abandoned scratch file, never masking the original failure.
 * @param tempPath - Absolute path of the scratch file.
 * @returns True when the path is gone.
 */
async function discardTemp(tempPath: string): Promise<boolean> {
  try {
    await fs.rm(tempPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish the token by atomically replacing the cache.
 *
 * <p>Tightening an existing file cannot work: POSIX checks permissions only
 * at `open`, so a reader that opened the old inode during any window keeps
 * its descriptor and reads whatever is written into that inode afterwards —
 * a later `fchmod` revokes nothing. The only safe move is to never write the
 * secret into a shared inode. A fresh `0600` file is created exclusively,
 * filled, then `rename`d over the cache: the replacement is atomic, so
 * readers see either the whole old file or the whole new one, and anyone
 * holding the old inode is left with the token they already had.
 *
 * <p>The move goes through {@link replaceAtomically} because Windows refuses
 * it while another process holds the cache open; dropping the token on that
 * refusal would cost the user an SMS on the next run.
 * @param cachePath - Absolute path.
 * @param token - Token string.
 * @returns True once the token is in place.
 */
async function writeOwnerOnly(cachePath: string, token: string): Promise<boolean> {
  const tempPath = `${cachePath}.${randomUUID()}.tmp`;
  try {
    await writeTempOwnerOnly(tempPath, token);
    return await replaceAtomically({ from: tempPath, to: cachePath });
  } catch (error) {
    await discardTemp(tempPath);
    throw error;
  }
}

/**
 * Safely write the cache file (UTF-8, truncating any prior content) with
 * owner-only permissions. Returns false on any write error.
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
    return await writeOwnerOnly(cachePath, token);
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    log.warn({ cachePath, code: e.code ?? 'UNKNOWN' }, 'TokenCache write failure');
    return false;
  }
}

/**
 * Remove the cache file so the next run re-authenticates from cold.
 *
 * <p>Called when the bank rejects a cached long-term token: leaving the
 * stale value on disk would make every later run pick the warm path and
 * fail the same way, which is how an expired token masquerades as a code
 * regression.
 * @param cachePath - Absolute path.
 * @param log - Logger for WARN diagnostics.
 * @returns True when the file is gone, false on an unlink error.
 */
async function deleteCacheSafe(cachePath: string, log: ScraperLogger): Promise<boolean> {
  try {
    await fs.rm(cachePath, { force: true });
    return true;
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    log.warn({ cachePath, code: e.code ?? 'UNKNOWN' }, 'TokenCache invalidate failure');
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
 * Disabled-cache invalidate — resolves to false.
 * @returns False Promise.
 */
function noopInvalidate(): Promise<boolean> {
  return Promise.resolve(false);
}

/**
 * Create a disabled (no-op) cache handle used when the env flag is
 * unset. All operations return '' / false / no-op writer.
 * @returns No-op cache handle.
 */
function createDisabledCache(): ITokenCacheHandle {
  return {
    enabled: false,
    read: noopRead,
    write: noopWrite,
    invalidate: noopInvalidate,
    writer: noopWriter,
  };
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
  const cachePath = cachePathFor(args.bankKey, args.dir);
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
  /**
   * Delete the cached token so the next run re-authenticates cold.
   * @returns True once the file is gone.
   */
  const invalidate = (): Promise<boolean> => deleteCacheSafe(cachePath, log);
  return { enabled: true, read, write, invalidate, writer };
}

export type { BankKey, ITokenCacheArgs, ITokenCacheHandle };
export { createTokenCache };
