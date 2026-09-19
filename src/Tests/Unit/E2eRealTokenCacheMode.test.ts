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

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { createTokenCache } from '../E2eReal/TokenCache.js';
import type { ICapturedEnvVar } from '../Helpers/AmbientEnv.js';
import { captureEnvVar, restoreEnvVar } from '../Helpers/AmbientEnv.js';
import { digestFileOrAbsent, digestOf } from '../Helpers/SecretDigest.js';

/** Env flag that switches the cache on. */
const FLAG = 'ONEZERO_OTP_LONG_TERM';

/**
 * The flag exactly as the host had it, captured before the fixture below
 * overwrites it. Nothing may destroy a value it has not first captured —
 * that is the whole point of the bug these tests guard.
 */
const HOST_FLAG = captureEnvVar(FLAG);

/**
 * Value standing in for the developer's own `.env`, which really does set
 * this flag. Installed before the hooks run so the suite is exercised
 * against a host that had the variable, not against an empty environment.
 */
const HOST_FLAG_VALUE = 'host-set-flag-value';

process.env[FLAG] = HOST_FLAG_VALUE;

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

/** The cache flag as the host had it before the current test changed it. */
let priorFlag: ICapturedEnvVar = captureEnvVar(FLAG);

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
  return path.join(sandbox, 'onezero-token.cache');
}

/**
 * Build the cache under test, pinned to the sandbox directory.
 *
 * <p>The directory is injected rather than steered through `TMPDIR`.
 * `os.tmpdir()` resolves `TMPDIR` via `safeGetenv`, which reads the real
 * process environ, but Jest gives each test module a *copy* of
 * `process.env` — so an override here never reaches `os.tmpdir()` and the
 * cache would quietly operate on the developer's real token instead.
 * @returns The token cache bound to the sandbox.
 */
function makeCache(): ReturnType<typeof createTokenCache> {
  const log = stubLog();
  return createTokenCache({ bankKey: 'onezero', envFlag: FLAG, log, dir: sandbox });
}

/**
 * Resolve the shared cache path the suite must never touch.
 * @returns Absolute path under the real `os.tmpdir()`.
 */
function sharedCachePath(): string {
  const tmp = os.tmpdir();
  return path.join(tmp, 'onezero-token.cache');
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
  const root = os.tmpdir();
  const prefix = path.join(root, 'tokencache-');
  sandbox = await fs.mkdtemp(prefix);
  priorFlag = captureEnvVar(FLAG);
  process.env[FLAG] = '1';
});

afterEach(async () => {
  restoreEnvVar(priorFlag);
  await fs.rm(sandbox, { recursive: true, force: true });
});

/**
 * Fail the suite if it handed the host environment back altered, then put
 * the host's own value back.
 *
 * <p>The restore is belt-and-braces: Jest gives every test file its own
 * `process.env` copy, so a write here cannot reach another file. That was
 * measured, not assumed — a canary set at module load in one file reads back
 * `undefined` in the next. The file still restores what it overwrote, because
 * "nothing observes it today" is not a reason to destroy a value, and the
 * isolation is Jest's to change.
 *
 * <p>`expect` is deliberately avoided here: `jest/no-standalone-expect`
 * forbids assertions outside a test body, and a throw fails the suite just
 * as loudly. The restore runs before the throw so it happens either way.
 * @returns True when the flag survived the run untouched.
 */
afterAll((): boolean => {
  const actual = process.env[FLAG];
  restoreEnvVar(HOST_FLAG);
  if (actual === HOST_FLAG_VALUE) return true;
  throw new ScraperError(`suite left ${FLAG} as ${String(actual)}, host had ${HOST_FLAG_VALUE}`);
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

/**
 * The suite must never write outside its sandbox.
 *
 * <p>`before` and `after` are digests, not contents: they describe whatever
 * the developer's real cache holds, and Jest publishes both operands of a
 * failed `toBe` straight into the console and the CI log. Digesting the
 * *contents* rather than probing for existence also keeps the check
 * order-independent — earlier tests in this file may already have created
 * the shared cache, so an existence probe would depend on who ran first.
 *
 * <p>An earlier revision steered the cache with `process.env.TMPDIR`, which
 * Jest never propagates to `os.tmpdir()`. Every "sandboxed" test therefore
 * operated on the *real* shared cache, so running the unit suite overwrote a
 * developer's live warm-start token with a fixture and cost them the SMS this
 * cache exists to avoid. The directory is injected now, and this pins it.
 */
describe('E2E-Real token cache — the suite stays inside its sandbox', () => {
  it('[E2E-REAL-CACHE] TokenCache_SandboxedWrite_ShouldLeaveTheSharedCacheByteIdentical', async () => {
    const shared = sharedCachePath();
    const before = await digestFileOrAbsent(shared);

    const cache = makeCache();
    await cache.write(TOKEN);

    const after = await digestFileOrAbsent(shared);
    const target = cachePath();
    const landed = await fs.readFile(target, 'utf8');
    expect(landed).toBe(TOKEN);
    expect(after).toBe(before);
    const fixtureDigest = digestOf(TOKEN);
    expect(after).not.toBe(fixtureDigest);
  });
});
