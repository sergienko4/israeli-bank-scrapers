/**
 * Token cache for the local Hapoalim runner.
 *
 * <p>The bundle holds live session cookies and the per-user device seed, so it
 * is written `0600` and never printed. A save failure is recorded here rather
 * than thrown into the scraper, whose auth-flow callback is documented to log
 * and swallow errors; the runner reads {@link ITokenSaver.failure} after the
 * scrape and exits non-zero, so a successful scrape cannot masquerade as a
 * usable warm start.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

import type { IAuthFlowInfo } from '../../../Scrapers/Base/Interface.js';
import { getDebug } from '../../../Scrapers/Pipeline/Logging/Debug.js';

const LOG = getDebug(import.meta.url);

/** Owner-only file mode for the token cache. */
const FILE_MODE = 0o600;

/** Fixed diagnostic that cannot quote the token or its contents. */
const TOKEN_CACHE_FAILURE = 'Hapoalim token cache write failed — the next run cannot warm-start';

/** A token sink that reports whether the last save succeeded. */
interface ITokenSaver {
  /** The scraper's auth-flow callback. */
  readonly save: (info: IAuthFlowInfo) => Promise<void>;
  /** The fixed failure text, or '' after a successful save. */
  readonly failure: () => string;
}

/**
 * Read a cached token, or '' when none exists.
 * @param file - Cache path.
 * @returns The trimmed token.
 */
async function readToken(file: string): Promise<string> {
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch {
    return '';
  }
}

/**
 * Remove a scratch file after a failed publish, never masking the original
 * write or rename error.
 * @param temp - Scratch path.
 * @returns True once the path is gone or the removal failed.
 */
async function discardTemp(temp: string): Promise<true> {
  try {
    await fs.rm(temp, { force: true });
  } catch {
    // Best-effort cleanup; the caller rethrows the original failure.
  }
  return true;
}

/**
 * Publish a token atomically in an owner-only file.
 * @param file - Cache path.
 * @param token - Token to write.
 * @returns The cache path.
 */
async function writeToken(file: string, token: string): Promise<string> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, token, { encoding: 'utf8', mode: FILE_MODE });
    await fs.rename(temp, file);
    return file;
  } catch (error) {
    await discardTemp(temp);
    throw error;
  }
}

/**
 * Build the token sink for one cache path.
 * @param file - Cache path.
 * @returns A callback plus its last fixed failure.
 */
function makeTokenSaver(file: string): ITokenSaver {
  let lastFailure = '';

  /**
   * Save the token this flow published.
   * @param info - Auth-flow info from the scraper.
   * @returns Nothing once the token is written, or when there is none.
   */
  async function save(info: IAuthFlowInfo): Promise<void> {
    if (info.longTermToken.length > 0) {
      try {
        const saved = await writeToken(file, info.longTermToken);
        lastFailure = '';
        LOG.info(
          { tokenFile: saved, tokenLength: info.longTermToken.length },
          'Hapoalim token cached',
        );
      } catch {
        lastFailure = TOKEN_CACHE_FAILURE;
        LOG.warn({ tokenFile: file }, TOKEN_CACHE_FAILURE);
      }
    }
  }

  /**
   * The last fixed failure, never the token.
   * @returns The diagnostic, or '' after a successful save.
   */
  const failure = (): string => lastFailure;

  return { save, failure };
}

export type { ITokenSaver };
export { makeTokenSaver, readToken, TOKEN_CACHE_FAILURE, writeToken };
