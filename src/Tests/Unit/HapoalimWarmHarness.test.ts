/**
 * HapoalimWarmHarness — the real-E2E warm harness, offline.
 *
 * <p>The live resume costs a second SMS if it silently falls back to a cold
 * login, so what that run does is proven here first: which flags select which
 * scenario, that a resume with no cached token stops before any scrape, and
 * that the cache is Hapoalim's own token file.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { DEFAULT_OTP_TIMEOUT_MS } from '../../Scrapers/Pipeline/Mediator/Timing/OtpTimingConfig.js';
import {
  createHapoalimWarmCache,
  ENROLL_ALLOWANCE,
  HAPOALIM_WARM_FLAGS,
  type HapoalimWarmRunKind,
  hapoalimWarmRunKindOf,
  planHapoalimWarmRun,
  resolveOtpTimeoutMs,
  RESUME_ALLOWANCE,
} from '../E2eReal/HapoalimWarmHarness.js';
import type { ITokenCacheHandle } from '../E2eReal/TokenCache.js';
import { captureEnvVar, type ICapturedEnvVar, restoreEnvVar } from '../Helpers/AmbientEnv.js';

/** Observed cache traffic, so tests can prove what was NOT touched. */
interface ICacheTraffic {
  reads: number;
  readonly writes: string[];
}

/** Fake cache handle plus the traffic it recorded. */
interface IFakeCache {
  readonly handle: ITokenCacheHandle;
  readonly traffic: ICacheTraffic;
}

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

/** Logger double shared by the cases below. */
const LOG = stubLog();

/**
 * Build an in-memory cache handle.
 * @param stored - What `read` returns.
 * @returns Handle plus its recorded traffic.
 */
function makeFakeCache(stored: string): IFakeCache {
  const traffic: ICacheTraffic = { reads: 0, writes: [] };
  const handle: ITokenCacheHandle = {
    enabled: true,
    /**
     * Record a read.
     * @returns The stored value.
     */
    read: (): Promise<string> => {
      traffic.reads += 1;
      return Promise.resolve(stored);
    },
    /**
     * Record a write.
     * @param token - Value written.
     * @returns True.
     */
    write: (token: string): Promise<boolean> => {
      traffic.writes.push(token);
      return Promise.resolve(true);
    },
    /**
     * Never used by the harness.
     * @returns False.
     */
    invalidate: (): Promise<boolean> => Promise.resolve(false),
    /**
     * Never used by the harness.
     * @returns Resolves immediately.
     */
    writer: (): Promise<void> => Promise.resolve(),
  };
  return { handle, traffic };
}

/** One flag combination and the run it must select. */
interface IFlagCase {
  readonly name: string;
  readonly env: NodeJS.ProcessEnv;
  readonly kind: HapoalimWarmRunKind;
}

const FLAG_CASES: readonly IFlagCase[] = [
  { name: 'no flags', env: {}, kind: 'off' },
  { name: 'an empty cache flag', env: { [HAPOALIM_WARM_FLAGS.cache]: '' }, kind: 'off' },
  {
    name: 'enroll without the cache flag',
    env: { [HAPOALIM_WARM_FLAGS.enroll]: '1' },
    kind: 'off',
  },
  { name: 'the cache flag alone', env: { [HAPOALIM_WARM_FLAGS.cache]: '1' }, kind: 'resume' },
  {
    name: 'cache + enroll',
    env: { [HAPOALIM_WARM_FLAGS.cache]: '1', [HAPOALIM_WARM_FLAGS.enroll]: '1' },
    kind: 'enroll',
  },
];

describe('hapoalimWarmRunKindOf', () => {
  it.each(FLAG_CASES)('selects $kind for $name', ({ env, kind }) => {
    const selected = hapoalimWarmRunKindOf(env);
    expect(selected).toBe(kind);
  });
});

/** A budget the resolver must accept. */
interface ITimeoutCase {
  readonly name: string;
  readonly flagValue: string;
  readonly timeoutMs: number;
}

const ACCEPTED_TIMEOUT_CASES: readonly ITimeoutCase[] = [
  { name: 'a positive budget', flagValue: '600000', timeoutMs: 600_000 },
];

/** A value the resolver must reject. */
interface IRejectedTimeoutCase {
  readonly name: string;
  readonly flagValue: string;
}

const REJECTED_TIMEOUT_CASES: readonly IRejectedTimeoutCase[] = [
  { name: 'zero', flagValue: '0' },
  { name: 'a negative budget', flagValue: '-5' },
  { name: 'a fraction', flagValue: '1.5' },
  { name: 'a word', flagValue: 'soon' },
];

describe('resolveOtpTimeoutMs', () => {
  it('returns the pipeline default when the flag is unset', () => {
    const resolved = resolveOtpTimeoutMs({});
    expect(resolved).toBe(DEFAULT_OTP_TIMEOUT_MS);
  });

  it('returns the pipeline default when the flag is empty', () => {
    const env = { [HAPOALIM_WARM_FLAGS.otpTimeout]: '' };
    const resolved = resolveOtpTimeoutMs(env);
    expect(resolved).toBe(DEFAULT_OTP_TIMEOUT_MS);
  });

  it.each(ACCEPTED_TIMEOUT_CASES)('returns $timeoutMs for $name', testCase => {
    const env = { [HAPOALIM_WARM_FLAGS.otpTimeout]: testCase.flagValue };
    const resolved = resolveOtpTimeoutMs(env);
    expect(resolved).toBe(testCase.timeoutMs);
  });

  it.each(REJECTED_TIMEOUT_CASES)('rejects $name', testCase => {
    const env = { [HAPOALIM_WARM_FLAGS.otpTimeout]: testCase.flagValue };
    expect(() => resolveOtpTimeoutMs(env)).toThrow(HAPOALIM_WARM_FLAGS.otpTimeout);
  });

  it('rejects a non-positive budget with a typed error', () => {
    const env = { [HAPOALIM_WARM_FLAGS.otpTimeout]: '0' };
    expect(() => resolveOtpTimeoutMs(env)).toThrow(ScraperError);
  });
});

describe('planHapoalimWarmRun — enrollment', () => {
  it('never reads the cache and allows one SMS', async () => {
    const cache = makeFakeCache('ignored');
    const plan = await planHapoalimWarmRun('enroll', cache.handle);
    expect(plan.token).toBe('');
    expect(plan.allowance).toEqual(ENROLL_ALLOWANCE);
    expect(cache.traffic.reads).toBe(0);
  });
});

describe('planHapoalimWarmRun — resume', () => {
  it('hands the scraper the stored token and allows no SMS', async () => {
    const cache = makeFakeCache('v1.synthetic');
    const plan = await planHapoalimWarmRun('resume', cache.handle);
    expect(plan.token).toBe('v1.synthetic');
    expect(plan.allowance).toEqual(RESUME_ALLOWANCE);
    expect(cache.traffic.writes).toEqual([]);
  });

  it('stops before any scrape when the cache is empty', async () => {
    const cache = makeFakeCache('');
    const planned = planHapoalimWarmRun('resume', cache.handle);
    await expect(planned).rejects.toThrow(HAPOALIM_WARM_FLAGS.enroll);
    expect(cache.traffic.writes).toEqual([]);
  });

  it('refuses an empty cache with a typed error, not a bare rejection', async () => {
    const cache = makeFakeCache('');
    const planned = planHapoalimWarmRun('resume', cache.handle);
    await expect(planned).rejects.toThrow(ScraperError);
  });
});

describe('createHapoalimWarmCache', () => {
  /** The flag that enables the cache for the cases below. */
  const cacheFlag = HAPOALIM_WARM_FLAGS.cache;

  /** The host's value, restored after each case. */
  let prior: ICapturedEnvVar = captureEnvVar(cacheFlag);

  beforeEach(() => {
    prior = captureEnvVar(cacheFlag);
  });

  afterEach(() => {
    restoreEnvVar(prior);
  });

  it('writes the hapoalim token file when the flag is on', async () => {
    process.env[cacheFlag] = '1';
    const root = os.tmpdir();
    const prefix = path.join(root, 'hapoalim-warm-');
    const dir = await fs.mkdtemp(prefix);
    try {
      const cache = createHapoalimWarmCache(LOG, dir);
      await cache.write('v1.synthetic');
      const target = path.join(dir, 'hapoalim-token.cache');
      const contents = await fs.readFile(target, 'utf8');
      expect(contents).toBe('v1.synthetic');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('is disabled when the flag is empty', () => {
    process.env[cacheFlag] = '';
    const cache = createHapoalimWarmCache(LOG);
    expect(cache.enabled).toBe(false);
  });
});
