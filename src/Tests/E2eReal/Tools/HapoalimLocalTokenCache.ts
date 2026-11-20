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

/** Fixed diagnostic for a write or rename failure. */
const TOKEN_CACHE_FAILURE = 'Hapoalim token cache write failed — the next run cannot warm-start';

/** Fixed diagnostic when a save does not settle before the runner's deadline. */
const TOKEN_CACHE_PENDING = 'Hapoalim token cache did not settle — the next run cannot warm-start';

/** The one file writer the sink uses; injectable for delayed-save tests. */
type TokenWriter = (file: string, token: string) => Promise<string>;

/** A token sink that reports whether the last save succeeded. */
interface ITokenSaver {
  /** The scraper's auth-flow callback. */
  readonly save: (info: IAuthFlowInfo) => Promise<void>;
  /** The fixed failure text, or '' after a successful save. */
  readonly failure: () => string;
  /** Await every queued save, failing closed at the deadline. */
  readonly settle: (timeoutMs: number) => Promise<string>;
}

/**
 * Race a completion signal against a timeout, clearing the owned timer when
 * either side settles.
 * @param completion - The queued saves.
 * @param ms - Deadline in milliseconds.
 * @returns True when the saves completed, false on timeout.
 */
function raceWithTimeout(completion: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof globalThis.setTimeout> | false = false;
  const timeout = new Promise<boolean>(resolve => {
    timer = globalThis.setTimeout(() => {
      resolve(false);
    }, ms);
  });
  const race = Promise.race([completion.then(() => true), timeout]);
  return race.finally(() => {
    if (timer !== false) globalThis.clearTimeout(timer);
  });
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
 * @param write - File writer; defaults to the owner-only atomic writer.
 * @returns A callback, its last fixed failure and a settle step.
 */
function makeTokenSaver(file: string, write: TokenWriter = writeToken): ITokenSaver {
  let lastFailure = '';
  let queue: Promise<void> = Promise.resolve();

  /**
   * Persist one token and record any fixed failure.
   * @param info - Auth-flow info from the scraper.
   * @returns Nothing once the write succeeds or fails.
   */
  async function persist(info: IAuthFlowInfo): Promise<void> {
    try {
      const saved = await write(file, info.longTermToken);
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

  /**
   * Queue a save in invocation order, so an older bundle cannot finish last.
   * @param info - Auth-flow info from the scraper.
   * @returns The save's completion.
   */
  function save(info: IAuthFlowInfo): Promise<void> {
    if (info.longTermToken.length === 0) return Promise.resolve();
    const next = queue.then(() => persist(info));
    queue = next;
    return next;
  }

  /**
   * Await every queued save, failing closed when the deadline passes.
   * @param timeoutMs - Runner-owned deadline.
   * @returns The fixed failure, or '' when all saves succeeded.
   */
  async function settle(timeoutMs: number): Promise<string> {
    const isCompleted = await raceWithTimeout(queue, timeoutMs);
    if (!isCompleted) lastFailure = TOKEN_CACHE_PENDING;
    return lastFailure;
  }

  /**
   * The last fixed failure, never the token.
   * @returns The diagnostic, or '' after a successful save.
   */
  const failure = (): string => lastFailure;

  return { save, failure, settle };
}

export type { ITokenSaver, TokenWriter };
export { makeTokenSaver, readToken, TOKEN_CACHE_FAILURE, TOKEN_CACHE_PENDING, writeToken };
