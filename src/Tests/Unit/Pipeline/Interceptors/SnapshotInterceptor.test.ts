/**
 * Unit tests for Interceptors/SnapshotInterceptor — factory + env-gated flow.
 */

import {
  createSnapshotInterceptor,
  isSnapshotEnabled,
} from '../../../../Scrapers/Pipeline/Interceptors/SnapshotInterceptor.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

const UNSET_SENTINEL = '__UNSET__';

/**
 * Save/restore env var helper.
 * @param value - New value (or UNSET_SENTINEL to delete).
 * @param fn - Test body.
 * @returns Resolves to true after restore.
 */
function withSnapshotEnv(value: string, fn: () => unknown): Promise<boolean> {
  const prior = process.env.DUMP_SNAPSHOTS ?? UNSET_SENTINEL;
  if (value === UNSET_SENTINEL) delete process.env.DUMP_SNAPSHOTS;
  else process.env.DUMP_SNAPSHOTS = value;
  /**
   * Restore env var to its prior value after test.
   * @returns True after restore.
   */
  const restore = (): boolean => {
    if (prior === UNSET_SENTINEL) delete process.env.DUMP_SNAPSHOTS;
    else process.env.DUMP_SNAPSHOTS = prior;
    return true;
  };
  const fnResult1 = fn();
  return Promise.resolve(fnResult1)
    .then(restore)
    .catch((err: unknown): never => {
      restore();
      throw err;
    });
}

describe('isSnapshotEnabled', () => {
  it('returns false when env flag unset', async () => {
    await withSnapshotEnv(UNSET_SENTINEL, (): boolean => {
      const isSnapshotEnabledResult2 = isSnapshotEnabled();
      expect(isSnapshotEnabledResult2).toBe(false);
      return true;
    });
  });

  it('returns true when env flag is "1"', async () => {
    await withSnapshotEnv('1', (): boolean => {
      const isSnapshotEnabledResult3 = isSnapshotEnabled();
      expect(isSnapshotEnabledResult3).toBe(true);
      return true;
    });
  });

  it('returns true when env flag is "true"', async () => {
    await withSnapshotEnv('true', (): boolean => {
      const isSnapshotEnabledResult4 = isSnapshotEnabled();
      expect(isSnapshotEnabledResult4).toBe(true);
      return true;
    });
  });

  it('returns false for other string values', async () => {
    await withSnapshotEnv('yes', (): boolean => {
      const isSnapshotEnabledResult5 = isSnapshotEnabled();
      expect(isSnapshotEnabledResult5).toBe(false);
      return true;
    });
  });
});

describe('createSnapshotInterceptor', () => {
  it('returns disabled interceptor when DUMP_SNAPSHOTS unset', async () => {
    await withSnapshotEnv(UNSET_SENTINEL, (): boolean => {
      const i = createSnapshotInterceptor();
      expect(i.name).toContain('disabled');
      return true;
    });
  });

  it('returns active interceptor when DUMP_SNAPSHOTS=1', async () => {
    await withSnapshotEnv('1', (): boolean => {
      const i = createSnapshotInterceptor();
      expect(i.name).toBe('SnapshotInterceptor');
      expect(typeof i.beforePhase).toBe('function');
      expect(typeof i.afterPipeline).toBe('function');
      return true;
    });
  });

  it('disabled interceptor beforePhase passes context through', async () => {
    await withSnapshotEnv(UNSET_SENTINEL, async (): Promise<boolean> => {
      const i = createSnapshotInterceptor();
      const ctx = makeMockContext();
      const result = await i.beforePhase(ctx, 'home');
      expect(result).toBeDefined();
      const isOkResult6 = isOk(result);
      expect(isOkResult6).toBe(true);
      return true;
    });
  });

  it('active interceptor beforePhase returns ctx when browser absent', async () => {
    await withSnapshotEnv('1', async (): Promise<boolean> => {
      const i = createSnapshotInterceptor();
      const ctx = makeMockContext();
      const result = await i.beforePhase(ctx, 'home');
      expect(result).toBeDefined();
      const isOkResult7 = isOk(result);
      expect(isOkResult7).toBe(true);
      return true;
    });
  });

  it('active interceptor afterPipeline returns false before any phase was seen', async () => {
    await withSnapshotEnv('1', async (): Promise<boolean> => {
      const i = createSnapshotInterceptor();
      const ctx = makeMockContext();
      const result = await i.afterPipeline?.(ctx);
      expect(result).toBeDefined();
      if (result && isOk(result)) expect(result.value).toBe(false);
      return true;
    });
  });

  it('active interceptor afterPipeline runs capture after phase seen', async () => {
    await withSnapshotEnv('1', async (): Promise<boolean> => {
      const i = createSnapshotInterceptor();
      const ctx = makeMockContext();
      await i.beforePhase(ctx, 'home');
      const result = await i.afterPipeline?.(ctx);
      expect(result).toBeDefined();
      return true;
    });
  });
});
