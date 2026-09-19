/**
 * Token-cache permissions — the owner-only guarantee must hold *during*
 * the write, not just after it.
 *
 * <p>`fs.writeFile`'s `mode` option only applies when the file is created.
 * A cache file that already exists with group/other read bits therefore
 * keeps them while the new token bytes land, and a tightening `chmod`
 * issued afterwards closes the door only once the secret is already on
 * disk. Any other local reader wins that window, and a crash inside it
 * leaves a long-lived bank token world-readable for good.
 *
 * <p>The fake filesystem below records the mode in force at the instant
 * each payload is written, so the invariant is asserted against the
 * bytes as they land rather than against a particular fs API.
 *
 * Fixtures are synthetic and carry zero PII.
 */

import { jest } from '@jest/globals';

import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';

const FLAG = 'E2E_TOKEN_CACHE_MODE_SPEC';
const TOKEN = 'synthetic-long-term-token';
const OWNER_ONLY = 0o600;
const GROUP_OTHER_BITS = 0o077;
const DEFAULT_CREATE_MODE = 0o666;
const PRE_EXISTING_LOOSE_MODE = 0o644;

/** One observed payload plus the mode the file carried as it landed. */
interface IObservedWrite {
  readonly content: string;
  readonly mode: number;
}

/** Mutable state of the single fake cache file. */
interface IFakeFile {
  exists: boolean;
  mode: number;
  content: string;
}

const FAKE_FILE: IFakeFile = { exists: false, mode: 0, content: '' };
const OBSERVED_WRITES: IObservedWrite[] = [];

/**
 * Create the file on first touch, mirroring POSIX create-time mode
 * semantics: the requested mode applies only when the file is new.
 * @param mode - Mode requested by the caller, if any.
 * @returns True when this call created the file.
 */
function ensureCreated(mode?: number): boolean {
  if (FAKE_FILE.exists) return false;
  FAKE_FILE.exists = true;
  FAKE_FILE.mode = mode ?? DEFAULT_CREATE_MODE;
  return true;
}

/**
 * Record a payload together with the mode in force as it was written.
 * @param data - Bytes handed to the filesystem.
 * @returns Number of observations recorded so far.
 */
function observe(data: string): number {
  FAKE_FILE.content = data;
  OBSERVED_WRITES.push({ content: data, mode: FAKE_FILE.mode });
  return OBSERVED_WRITES.length;
}

/**
 * Path-based write — the racy API: mode is honoured on create only.
 * @param _path - Ignored; the fake models one file.
 * @param data - Payload.
 * @param options - Optional mode bag.
 * @param options.mode - Mode requested at creation.
 * @returns Promise resolving once the payload is recorded.
 */
async function fakeWriteFile(
  _path: string,
  data: string,
  options?: { readonly mode?: number },
): Promise<number> {
  ensureCreated(options?.mode);
  const count = observe(data);
  return Promise.resolve(count);
}

/**
 * Change the mode of the fake file.
 * @param _path - Ignored.
 * @param mode - New mode.
 * @returns Promise resolving to the applied mode.
 */
async function fakeChmod(_path: string, mode: number): Promise<number> {
  FAKE_FILE.mode = mode;
  return Promise.resolve(mode);
}

/**
 * Descriptor-based open. `w` truncates, so an existing file is emptied
 * before any new byte is written — that is what makes an `fchmod` here
 * safe rather than merely tidy.
 * @param _path - Ignored.
 * @param _flags - Ignored; the fake models `w`.
 * @param mode - Mode requested at creation.
 * @returns Handle exposing chmod/writeFile/close.
 */
async function fakeOpen(_path: string, _flags: string, mode?: number): Promise<IFakeHandle> {
  ensureCreated(mode);
  FAKE_FILE.content = '';
  const handle = buildHandle();
  return Promise.resolve(handle);
}

/** The subset of FileHandle the cache is allowed to rely on. */
interface IFakeHandle {
  chmod: (mode: number) => Promise<number>;
  writeFile: (data: string, options?: { readonly encoding?: string }) => Promise<number>;
  close: () => Promise<boolean>;
}

/**
 * Build a fake FileHandle bound to the single modelled file.
 * @returns Handle double.
 */
function buildHandle(): IFakeHandle {
  return {
    /**
     * Tighten the mode of the already-open, already-truncated file.
     * @param mode - Mode to apply.
     * @returns The applied mode.
     */
    chmod: (mode: number): Promise<number> => fakeChmod('', mode),
    /**
     * Write through the descriptor, recording the mode in force.
     * @param data - Payload.
     * @returns Count of observations so far.
     */
    writeFile: (data: string): Promise<number> => {
      const count = observe(data);
      return Promise.resolve(count);
    },
    /**
     * Release the descriptor.
     * @returns Always true; the fake holds no OS resource.
     */
    close: (): Promise<boolean> => Promise.resolve(true),
  };
}

jest.unstable_mockModule('node:fs/promises', () => ({
  writeFile: fakeWriteFile,
  chmod: fakeChmod,
  open: fakeOpen,
  /**
   * Unused by these cases; the cache reads elsewhere.
   * @returns Empty contents.
   */
  readFile: (): Promise<string> => Promise.resolve(''),
  /**
   * Unused by these cases; present so the module shape is complete.
   * @returns Always true.
   */
  rm: (): Promise<boolean> => Promise.resolve(true),
}));

const TOKEN_CACHE_MODULE = await import('../E2eReal/TokenCache.js');

/**
 * Build a logger stub — diagnostics are not under test here.
 * @returns Logger double.
 */
function stubLog(): ScraperLogger {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return log as unknown as ScraperLogger;
}

/**
 * Seed a cache file that already exists with loose permissions, which is
 * the only situation in which the bug is reachable.
 * @returns The seeded mode.
 */
function seedLooseCacheFile(): number {
  FAKE_FILE.exists = true;
  FAKE_FILE.mode = PRE_EXISTING_LOOSE_MODE;
  FAKE_FILE.content = 'previous-token';
  OBSERVED_WRITES.length = 0;
  return FAKE_FILE.mode;
}

/**
 * Every observation whose payload carried the token while the file was
 * readable by group or other.
 * @returns Offending observations.
 */
function leakedWrites(): IObservedWrite[] {
  return OBSERVED_WRITES.filter(
    w => w.content.includes(TOKEN) && (w.mode & GROUP_OTHER_BITS) !== 0,
  );
}

/**
 * Build the cache under test with a throwaway logger.
 * @returns The token cache bound to the fake filesystem.
 */
function makeCache(): ReturnType<typeof TOKEN_CACHE_MODULE.createTokenCache> {
  const log = stubLog();
  return TOKEN_CACHE_MODULE.createTokenCache({ bankKey: 'onezero', envFlag: FLAG, log });
}

describe('E2E-Real token cache — owner-only during the write', () => {
  beforeEach(() => {
    process.env[FLAG] = '1';
    FAKE_FILE.exists = false;
    FAKE_FILE.mode = 0;
    FAKE_FILE.content = '';
    OBSERVED_WRITES.length = 0;
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, FLAG);
  });

  it('[E2E-REAL-CACHE] TokenCache_PreExistingLooseFile_ShouldNeverWriteTokenWhileReadable', async () => {
    seedLooseCacheFile();
    const cache = makeCache();

    await cache.write(TOKEN);

    const didWriteToken = OBSERVED_WRITES.some(w => w.content.includes(TOKEN));
    const leaked = leakedWrites();
    expect(didWriteToken).toBe(true);
    expect(leaked).toStrictEqual([]);
  });

  it('[E2E-REAL-CACHE] TokenCache_PreExistingLooseFile_ShouldEndOwnerOnly', async () => {
    seedLooseCacheFile();
    const cache = makeCache();

    await cache.write(TOKEN);

    expect(FAKE_FILE.mode).toBe(OWNER_ONLY);
    expect(FAKE_FILE.content).toBe(TOKEN);
  });

  it('[E2E-REAL-CACHE] TokenCache_NewFile_ShouldCreateOwnerOnly', async () => {
    const cache = makeCache();

    await cache.write(TOKEN);

    const leaked = leakedWrites();
    expect(leaked).toStrictEqual([]);
    expect(FAKE_FILE.mode).toBe(OWNER_ONLY);
  });
});
