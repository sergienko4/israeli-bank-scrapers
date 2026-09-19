/**
 * Token-cache permissions — the owner-only guarantee has to survive a
 * reader that is already watching the cache path.
 *
 * <p>POSIX checks permissions at `open` and never again. A process that
 * opens the cache while it is group/other-readable keeps a working
 * descriptor for that inode forever, so tightening the mode afterwards
 * revokes nothing: whatever is written into that inode next is readable
 * through the descriptor it already holds. Writing the token into the
 * existing cache inode therefore leaks it no matter how the mode is
 * ordered, which is why the token is written to a fresh `0600` inode and
 * `rename`d into place instead.
 *
 * <p>These run against the real filesystem in an isolated temp dir, so
 * they pin the behaviour rather than a filesystem double. The tokens are
 * synthetic and carry zero PII.
 */

import { closeSync, openSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { createTokenCache } from '../E2eReal/TokenCache.js';

/** Env flag that switches the cache on. */
const FLAG = 'ONEZERO_OTP_LONG_TERM';

/** Synthetic secret — never a real credential. */
const TOKEN = 'SYNTHETIC-DURABLE-TOKEN';

/** Value a pre-existing cache holds before the run. */
const PRIOR = 'previous-token';

/** Owner-only mode the cache must end up with. */
const OWNER_ONLY = 0o600;

/** Mode bits that must never be set on a file holding the token. */
const GROUP_OTHER_BITS = 0o077;

/** Isolated tmp dir backing `os.tmpdir()` for one test. */
let sandbox = '';

/** Previous TMPDIR, restored after each test. */
let priorTmpDir: string | undefined;

/**
 * Build a logger stub — diagnostics are not under test here.
 * @returns Logger double.
 */
function stubLog(): ScraperLogger {
  /**
   * Swallow a diagnostic.
   * @returns True; nothing is recorded.
   */
  function ignore(): boolean {
    return true;
  }
  const log = { info: ignore, warn: ignore, error: ignore, debug: ignore };
  return log as unknown as ScraperLogger;
}

/**
 * Resolve the cache path the helper will use inside the sandbox.
 * @returns Absolute cache path.
 */
function cachePath(): string {
  const tmp = os.tmpdir();
  return path.join(tmp, 'onezero-token.cache');
}

/**
 * Build the cache under test with a throwaway logger.
 * @returns The token cache bound to the sandbox.
 */
function makeCache(): ReturnType<typeof createTokenCache> {
  const log = stubLog();
  return createTokenCache({ bankKey: 'onezero', envFlag: FLAG, log });
}

/**
 * Seed a cache that already exists, owner-only.
 *
 * <p>The seed is deliberately `0600`: the leak does not depend on loose
 * bits. Reusing the published inode is what exposes the token, so any
 * reader that already has it open — a same-user process here, another
 * local user when the bits are looser — reads whatever lands in it next.
 * Seeding tight keeps the test from creating a world-readable file just
 * to prove a point the tight case already proves.
 * @returns The seeded path.
 */
async function seedExistingCache(): Promise<string> {
  const target = cachePath();
  await fs.writeFile(target, PRIOR, { mode: OWNER_ONLY });
  return target;
}

/**
 * Hold a read descriptor on the cache across a write, the way a hostile
 * watcher would, and report what that descriptor can still see afterwards.
 *
 * <p>The explicit owner-only mode on the `open` is inert under `'r'` (no
 * `O_CREAT`, so the kernel ignores it), but it is stated anyway: an `open`
 * against a path in the shared temp dir that names no mode is the exact
 * shape that creates a world-readable file the moment the flag gains
 * `O_CREAT`, and pinning it here keeps that shape out of the codebase.
 * @param target - Cache path to watch.
 * @param write - Cache write to run while the descriptor is held.
 * @returns Contents visible through the descriptor taken before the write.
 */
async function readAcrossWrite(target: string, write: () => Promise<unknown>): Promise<string> {
  const watcherFd = openSync(target, 'r', OWNER_ONLY);
  try {
    await write();
    return readFileSync(watcherFd, 'utf8');
  } finally {
    closeSync(watcherFd);
  }
}

/**
 * Read the permission bits currently on a path.
 * @param target - Absolute path.
 * @returns Mode bits masked to the permission octet.
 */
async function modeOf(target: string): Promise<number> {
  const info = await fs.stat(target);
  return info.mode & 0o777;
}

/**
 * List leftover scratch files beside the cache.
 * @returns Names of any `.tmp` files still present.
 */
async function strayTempFiles(): Promise<string[]> {
  const entries = await fs.readdir(sandbox);
  return entries.filter(name => name.endsWith('.tmp'));
}

beforeEach(async () => {
  priorTmpDir = process.env.TMPDIR;
  const root = os.tmpdir();
  const prefix = path.join(root, 'tokencache-');
  sandbox = await fs.mkdtemp(prefix);
  process.env.TMPDIR = sandbox;
  process.env[FLAG] = '1';
});

afterEach(async () => {
  Reflect.deleteProperty(process.env, FLAG);
  if (priorTmpDir === undefined) Reflect.deleteProperty(process.env, 'TMPDIR');
  else process.env.TMPDIR = priorTmpDir;
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('E2E-Real token cache — the token never enters a shared inode', () => {
  it('[E2E-REAL-CACHE] TokenCache_ReaderHoldingOldDescriptor_ShouldNeverSeeTheNewToken', async () => {
    const target = await seedExistingCache();
    const cache = makeCache();
    /**
     * Publish the new token into the cache.
     * @returns True once the write landed.
     */
    const writeToken = async (): Promise<boolean> => cache.write(TOKEN);

    const throughOldFd = await readAcrossWrite(target, writeToken);

    expect(throughOldFd).not.toContain(TOKEN);
    expect(throughOldFd).toBe(PRIOR);
  });

  it('[E2E-REAL-CACHE] TokenCache_PreExistingCache_ShouldPublishOwnerOnly', async () => {
    const target = await seedExistingCache();

    const cache = makeCache();
    await cache.write(TOKEN);

    const mode = await modeOf(target);
    const contents = await fs.readFile(target, 'utf8');
    expect(mode & GROUP_OTHER_BITS).toBe(0);
    expect(mode).toBe(OWNER_ONLY);
    expect(contents).toBe(TOKEN);
  });

  it('[E2E-REAL-CACHE] TokenCache_NewFile_ShouldCreateOwnerOnly', async () => {
    const cache = makeCache();
    await cache.write(TOKEN);

    const target = cachePath();
    const mode = await modeOf(target);
    const contents = await fs.readFile(target, 'utf8');
    expect(mode).toBe(OWNER_ONLY);
    expect(contents).toBe(TOKEN);
  });

  it('[E2E-REAL-CACHE] TokenCache_AfterWrite_ShouldLeaveNoScratchFile', async () => {
    const cache = makeCache();
    await cache.write(TOKEN);

    const strays = await strayTempFiles();
    expect(strays).toStrictEqual([]);
  });
});
