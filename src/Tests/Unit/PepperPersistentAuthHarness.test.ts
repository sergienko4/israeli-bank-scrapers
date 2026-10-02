/**
 * PepperPersistentAuthHarness — the real-E2E durable harness, offline.
 *
 * <p>The live run costs an SMS and a real account, so everything that decides
 * what that run does is proven here first: which flags select which run, that
 * a durable run with no cached state stops before any scrape instead of
 * enrolling, that forced expiry touches only the in-memory access token, that
 * a plain resume is predicted from Pepper's own freshness rule, and that a
 * state the cache failed to persist is reported as a failure.
 */

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { isJwtFresh } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/Jwt/GenericJwtClaims.js';
import type { IRehydratedPersistentAuth } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateCodec.js';
import { PEPPER_API_DIRECT_CALL } from '../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepper.js';
import { PEPPER_MOCK_CREDS } from '../E2eMocked/Pepper/PepperFetchMock.js';
import {
  decodeDurable,
  makeBoundDevice,
} from '../E2eMocked/Pepper/PepperPersistentAuthFixtures.js';
import {
  buildDurableSink,
  DURABLE_FLAGS,
  type DurableRunKind,
  durableRunKindOf,
  ENROLL_ALLOWANCE,
  type IDurableRunPlan,
  planDurableRun,
  RESUME_ALLOWANCE,
} from '../E2eReal/PepperDurableHarness.js';
import { REPLAY_BUFFER_SECONDS } from '../E2eReal/PepperDurableState.js';
import type { ITokenCacheHandle } from '../E2eReal/TokenCache.js';
import { makeJwtExpiringIn } from '../Helpers/Jwt.js';

/** Raw phone credential the harness receives; normalizes to the fixture account. */
const RAW_PHONE = PEPPER_MOCK_CREDS.phoneNumber;

/** Synthetic local-format phone: the pipeline refuses it (issue #552), so must the harness. */
const LOCAL_PHONE = '0501234567';

/** Synthetic second account: a state bound to it must never resume here. */
const FOREIGN_ACCOUNT = '972000000001';

/** Pepper's own durable replay margin, read from its config (NaN fails loudly). */
const PEPPER_MARGIN_SECONDS =
  PEPPER_API_DIRECT_CALL.persistentAuth?.freshnessMarginSeconds ?? Number.NaN;

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
 * Build an in-memory cache handle.
 * @param stored - What `read` returns.
 * @param isWritable - What `write` reports.
 * @returns Handle plus its recorded traffic.
 */
function makeFakeCache(stored: string, isWritable = true): IFakeCache {
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
     * @param state - Value written.
     * @returns The configured write outcome.
     */
    write: (state: string): Promise<boolean> => {
      traffic.writes.push(state);
      return Promise.resolve(isWritable);
    },
    /**
     * Never used by the durable harness.
     * @returns False.
     */
    invalidate: (): Promise<boolean> => Promise.resolve(false),
    /**
     * Never used by the durable harness.
     * @returns Resolves immediately.
     */
    writer: (): Promise<void> => Promise.resolve(),
  };
  return { handle, traffic };
}

/**
 * Plan a run against a fake cache holding one bound device's state.
 * @param kind - Durable run kind.
 * @param accessToken - Token the stored state carries.
 * @returns Plan, the stored state, and the cache traffic.
 */
async function planWithStoredToken(
  kind: Exclude<DurableRunKind, 'off'>,
  accessToken: string,
): Promise<{ plan: IDurableRunPlan; stored: string; traffic: ICacheTraffic }> {
  const device = makeBoundDevice(accessToken);
  const cache = makeFakeCache(device.encoded);
  const plan = await planDurableRun(kind, cache.handle, RAW_PHONE);
  return { plan, stored: device.encoded, traffic: cache.traffic };
}

/**
 * The state a plan hands the scraper, decoded against the fixture account.
 * @param plan - Durable run plan.
 * @returns Rehydrated state.
 */
function decodePlanned(plan: IDurableRunPlan): IRehydratedPersistentAuth {
  const encoded = plan.stateOption.persistentAuthState ?? '';
  return decodeDurable(encoded);
}

/** One flag combination and the run it must select. */
interface IFlagCase {
  readonly name: string;
  readonly env: NodeJS.ProcessEnv;
  readonly kind: DurableRunKind;
}

const FLAG_CASES: readonly IFlagCase[] = [
  { name: 'no flags', env: {}, kind: 'off' },
  { name: 'an empty enable flag', env: { [DURABLE_FLAGS.enable]: '' }, kind: 'off' },
  { name: 'enroll without enable', env: { [DURABLE_FLAGS.enroll]: '1' }, kind: 'off' },
  { name: 'enable alone', env: { [DURABLE_FLAGS.enable]: '1' }, kind: 'resume' },
  {
    name: 'enable + enroll',
    env: { [DURABLE_FLAGS.enable]: '1', [DURABLE_FLAGS.enroll]: '1' },
    kind: 'enroll',
  },
  {
    name: 'enable + force-expiry',
    env: { [DURABLE_FLAGS.enable]: '1', [DURABLE_FLAGS.forceExpiry]: '1' },
    kind: 'resume-expired',
  },
];

describe('durableRunKindOf', () => {
  it.each(FLAG_CASES)('selects $kind for $name', ({ env, kind }) => {
    const selected = durableRunKindOf(env);
    expect(selected).toBe(kind);
  });

  it('refuses enrollment and forced expiry together', () => {
    const env = {
      [DURABLE_FLAGS.enable]: '1',
      [DURABLE_FLAGS.enroll]: '1',
      [DURABLE_FLAGS.forceExpiry]: '1',
    };
    /**
     * Select a run from contradictory flags.
     * @returns Never — the selector throws.
     */
    const select = (): DurableRunKind => durableRunKindOf(env);
    expect(select).toThrow(ScraperError);
  });
});

describe('buildDurableSink', () => {
  it('persists the state, then records the publication', async () => {
    const cache = makeFakeCache('');
    let stored = 0;
    const sink = buildDurableSink(cache.handle, (): number => (stored += 1));
    await sink('state-a');
    expect(cache.traffic.writes).toEqual(['state-a']);
    expect(stored).toBe(1);
  });

  it('throws when the cache did not persist the state', async () => {
    const cache = makeFakeCache('', false);
    let stored = 0;
    const sink = buildDurableSink(cache.handle, (): number => (stored += 1));
    const publish = sink('state-a');
    await expect(publish).rejects.toThrow('durable state was not persisted');
    expect(stored).toBe(0);
  });
});

describe('planDurableRun — enrollment', () => {
  it('never reads the cache and allows exactly one SMS', async () => {
    const cache = makeFakeCache('ignored');
    const plan = await planDurableRun('enroll', cache.handle, RAW_PHONE);
    expect(plan.stateOption).toEqual({});
    expect(plan.allowance).toEqual(ENROLL_ALLOWANCE);
    expect(cache.traffic.reads).toBe(0);
  });
});

describe('planDurableRun — missing or unusable state never enrolls', () => {
  it.each(['resume', 'resume-expired'] as const)(
    '%s with an empty cache stops before any scrape',
    async kind => {
      const cache = makeFakeCache('');
      const planned = planDurableRun(kind, cache.handle, RAW_PHONE);
      await expect(planned).rejects.toThrow(DURABLE_FLAGS.enroll);
      expect(cache.traffic.writes).toEqual([]);
    },
  );

  it.each(['resume', 'resume-expired'] as const)(
    '%s refuses a state bound to another account',
    async kind => {
      const fresh = makeJwtExpiringIn(3600);
      const foreign = makeBoundDevice(fresh, { account: FOREIGN_ACCOUNT });
      const cache = makeFakeCache(foreign.encoded);
      const planned = planDurableRun(kind, cache.handle, RAW_PHONE);
      await expect(planned).rejects.toThrow(ScraperError);
    },
  );

  it('refuses a corrupt state under forced expiry', async () => {
    const cache = makeFakeCache('not-a-state');
    const planned = planDurableRun('resume-expired', cache.handle, RAW_PHONE);
    await expect(planned).rejects.toThrow(ScraperError);
  });
});

describe('planDurableRun — plain resume is predicted from Pepper freshness', () => {
  it('expects a replay with no publication for a fresh token', async () => {
    const fresh = makeJwtExpiringIn(3600);
    const { plan, stored } = await planWithStoredToken('resume', fresh);
    expect(plan.stateOption.persistentAuthState).toBe(stored);
    expect(plan.allowance).toEqual(RESUME_ALLOWANCE.replay);
  });

  it('expects one renewal publication for an expired token', async () => {
    const expired = makeJwtExpiringIn(-60);
    const { plan, stored } = await planWithStoredToken('resume', expired);
    expect(plan.stateOption.persistentAuthState).toBe(stored);
    expect(plan.allowance).toEqual(RESUME_ALLOWANCE.renew);
  });

  it('refuses a phone the pipeline cannot normalize, before any scrape', async () => {
    const fresh = makeJwtExpiringIn(3600);
    const device = makeBoundDevice(fresh);
    const cache = makeFakeCache(device.encoded);
    const planned = planDurableRun('resume', cache.handle, LOCAL_PHONE);
    await expect(planned).rejects.toThrow('cannot be normalized');
  });

  it('refuses a token inside the replay buffer instead of guessing', async () => {
    const atMargin = makeJwtExpiringIn(PEPPER_MARGIN_SECONDS + REPLAY_BUFFER_SECONDS / 2);
    const planned = planWithStoredToken('resume', atMargin);
    await expect(planned).rejects.toThrow('replay margin');
  });
});

describe('planDurableRun — forced expiry', () => {
  it('swaps only the in-memory access token and writes nothing', async () => {
    const fresh = makeJwtExpiringIn(3600);
    const { plan, stored, traffic } = await planWithStoredToken('resume-expired', fresh);
    const before = decodeDurable(stored);
    const after = decodePlanned(plan);
    const { accessToken: forcedToken, ...afterRest } = after.state;
    const { accessToken: storedToken, ...beforeRest } = before.state;
    expect(afterRest).toEqual(beforeRest);
    expect(forcedToken).not.toBe(storedToken);
    expect(traffic.writes).toEqual([]);
  });

  it('hands the scraper a token Pepper treats as expired', async () => {
    const fresh = makeJwtExpiringIn(3600);
    const { plan } = await planWithStoredToken('resume-expired', fresh);
    const forced = decodePlanned(plan);
    const rule = { freshnessField: 'exp', skewSeconds: PEPPER_MARGIN_SECONDS } as const;
    const isFresh = isJwtFresh(forced.state.accessToken, rule);
    expect(isFresh).toBe(false);
    expect(plan.allowance).toEqual(RESUME_ALLOWANCE.renew);
  });
});
