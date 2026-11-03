/**
 * Cookie-jar warm start (UT-WJ).
 *
 * A cookie-session bank has no bearer to replay, so its warm token is the
 * session jar itself: a `v1.` envelope bound to the provider and to a hash of
 * the account. A token failing any check is skipped with its reason only and
 * the cold login runs. A resume the bank rejects clears the jar before the one
 * cold login, so neither imported nor validation-response cookies reach it.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../../Scrapers/Base/Interface.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IConfigTokenStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { IStoredCookie } from '../../../../../../Scrapers/Pipeline/Types/Domain/CookieSession.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import {
  COOKIE_MARKER as MARKER,
  type IJarSpy,
  makeJarSpy,
  WARM_COOKIES as COOKIES,
} from './WarmJarSpy.js';
import { makeJwt, WARM_STEP_TAG, warmTwoStepConfig } from './WarmStartFixtures.js';

/** Logger shared by the modules under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * Every module derives its logger from `import.meta.url`.
   * @returns The shared mock logger.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const CODEC =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCookieJar.js');
const STRATEGY =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js');
const RESOLVER =
  await import('../../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js');
const MEDIATOR = await import('../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js');
const URLS = await import('../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js');

type RejectionKey = keyof typeof CODEC.WARM_JAR_REJECTIONS;

const CTX = { companyId: CompanyTypes.OneZero } as unknown as ITokenContext;
const PROVIDER = 'syn-bank';
const ACCOUNT = 'syn-user';
const IDENTITY = { provider: PROVIDER, account: ACCOUNT } as const;
const LIMIT = 16384;
/** A bank answer carrying the bearer each step extracts to carry. */
const STEP_OK: Procedure<unknown> = succeed({ access_token: makeJwt(36000) });
/** Steps a cold flow walks — the whole list. */
const COLD_STEPS = 2;
/** Steps a warm resume walks — everything from `fromStepIndex` on. */
const WARM_STEPS = 1;

const GROWN_COOKIES = COOKIES.map((cookie): IStoredCookie => ({
  ...cookie,
  value: `${cookie.value}-refreshed`,
}));

/** Who a test jar belongs to. */
type JarIdentity = Parameters<typeof CODEC.encodeWarmJar>[0];

/**
 * Encode the test cookies for an identity that has an account.
 * @param identity - Provider and account.
 * @returns A `v1.` token.
 */
function encodeOk(identity: JarIdentity): string {
  const token = CODEC.encodeWarmJar(identity, COOKIES);
  assertOk(token);
  return token.value;
}

const GOOD = encodeOk(IDENTITY);
/** Jar event of the stored jar's import before any request. */
const IMPORTED = `import${String(COOKIES.length)}@0`;
/** Jar event of the clear once the warm resume's request has gone out. */
const CLEARED_AFTER_RESUME = `clear@${String(WARM_STEPS)}`;

beforeAll((): void => {
  URLS.registerWkUrl(WARM_STEP_TAG, CompanyTypes.OneZero, 'https://example.test/api/warm-tag');
});

beforeEach((): void => {
  LOG.warn.mockClear();
});

/**
 * Wrap raw JSON text the way a `v1.` envelope carries it.
 * @param json - Envelope JSON text.
 * @returns A `v1.` token.
 */
function wrapJson(json: string): string {
  const body = Buffer.from(json, 'utf8').toString('base64url');
  return `v1.${body}`;
}

/**
 * Wrap an envelope object.
 * @param envelope - Envelope payload.
 * @returns A `v1.` token.
 */
function wrapObject(envelope: object): string {
  const json = JSON.stringify(envelope);
  return wrapJson(json);
}

/**
 * Decode a token against the test identity.
 * @param token - Stored token.
 * @param maxChars - Size limit.
 * @returns The decoded cookies, or the rejection.
 */
function decode(token: string, maxChars = LIMIT): Procedure<readonly IStoredCookie[]> {
  return CODEC.decodeWarmJar(token, { ...IDENTITY, maxChars });
}

/** A stored token and the reason it is refused. */
interface IRejectCase {
  readonly label: string;
  readonly token: string;
  readonly maxChars: number;
  readonly reason: RejectionKey;
}

const COOKIE_WITHOUT_VALUE = { ...COOKIES[0], value: undefined };
const COOKIE_WITH_TEXT_FLAG = { ...COOKIES[0], secure: 'yes' };

const REJECTED: readonly IRejectCase[] = [
  { label: 'a foreign prefix', token: `v2${GOOD.slice(2)}`, maxChars: LIMIT, reason: 'prefix' },
  { label: 'a token over the limit', token: GOOD, maxChars: GOOD.length - 1, reason: 'size' },
  { label: 'unreadable JSON', token: wrapJson('{'), maxChars: LIMIT, reason: 'json' },
  { label: 'a JSON array', token: wrapObject([]), maxChars: LIMIT, reason: 'schema' },
  {
    label: 'a cookie list that is no array',
    token: wrapObject({ p: PROVIDER, a: 'x', c: {} }),
    maxChars: LIMIT,
    reason: 'schema',
  },
  {
    label: 'a cookie without a value',
    token: wrapObject({ p: PROVIDER, a: 'x', c: [COOKIE_WITHOUT_VALUE] }),
    maxChars: LIMIT,
    reason: 'schema',
  },
  {
    label: 'a cookie flag that is text',
    token: wrapObject({ p: PROVIDER, a: 'x', c: [COOKIE_WITH_TEXT_FLAG] }),
    maxChars: LIMIT,
    reason: 'schema',
  },
  {
    label: 'another provider',
    token: encodeOk({ provider: 'syn-other', account: ACCOUNT }),
    maxChars: LIMIT,
    reason: 'provider',
  },
  {
    label: 'another account',
    token: encodeOk({ provider: PROVIDER, account: 'syn-other' }),
    maxChars: LIMIT,
    reason: 'account',
  },
];

describe('cookie-jar warm envelope', () => {
  it('round-trips the jar', (): void => {
    const decoded = decode(GOOD);
    const roundTrip = succeed(COOKIES);
    const isV1 = GOOD.startsWith('v1.');
    expect(decoded).toEqual(roundTrip);
    expect(isV1).toBe(true);
  });

  it('accepts a token of exactly the limit', (): void => {
    const decoded = decode(GOOD, GOOD.length);
    assertOk(decoded);
  });

  it('binds a hash of the account, never the account itself', (): void => {
    const encoded = GOOD.slice('v1.'.length);
    const body = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(body).not.toContain(ACCOUNT);
    const decoded = CODEC.decodeWarmJar(GOOD, {
      ...IDENTITY,
      account: ` ${ACCOUNT} `,
      maxChars: LIMIT,
    });
    assertOk(decoded);
  });

  it.each(REJECTED)('refuses $label', (row): void => {
    const decoded = decode(row.token, row.maxChars);
    const reason = CODEC.WARM_JAR_REJECTIONS[row.reason];
    const refused = fail(ScraperErrorTypes.Generic, reason);
    expect(decoded).toEqual(refused);
  });

  it.each(['', ' \t'])('binds no jar to the blank account %j', (account): void => {
    const unbound = fail(ScraperErrorTypes.Generic, CODEC.WARM_JAR_REJECTIONS.unbound);
    const encoded = CODEC.encodeWarmJar({ provider: PROVIDER, account }, COOKIES);
    const decoded = CODEC.decodeWarmJar(GOOD, { provider: PROVIDER, account, maxChars: LIMIT });
    expect(encoded).toEqual(unbound);
    expect(decoded).toEqual(unbound);
  });
});

/**
 * Cookie-jar call config over the shared two-step warm flow.
 * @param maxTokenChars - Export / import ceiling.
 * @returns Call config warm-starting from step 1 with a bank call.
 */
function jarConfig(maxTokenChars = LIMIT): IApiDirectCallConfig {
  const { flow, envelope, probe, steps } = warmTwoStepConfig();
  const warmStart = {
    kind: 'cookie-jar',
    credsField: 'otpLongTermToken',
    fromStepIndex: 1,
    validation: 'bank-call',
    provider: PROVIDER,
    accountField: 'userCode',
    maxTokenChars,
  } as const;
  return { flow, envelope, probe, steps, warmStart };
}

/** Strategy, bus, jar and request log for one run. */
interface IJarRun {
  readonly strategy: IConfigTokenStrategy;
  readonly bus: ITokenBus;
  readonly jar: IJarSpy;
  readonly captures: IApiPostCapture[];
}

/**
 * Build the strategy under test.
 * @param config - Call config.
 * @returns The strategy.
 */
function makeStrategy(config: IApiDirectCallConfig): IConfigTokenStrategy {
  const proc = STRATEGY.createTokenStrategyFromConfig({ config });
  assertOk(proc);
  return proc.value;
}

/** Inputs for one run. */
interface IJarRunArgs {
  readonly responses: readonly Procedure<unknown>[];
  readonly maxTokenChars?: number;
  readonly hasSession?: boolean;
}

/**
 * Wire a strategy to a scripted bus carrying a spying jar.
 * @param args - Scripted answers, ceiling and whether the bus has a jar.
 * @returns The run's parts.
 */
function makeRun(args: IJarRunArgs): IJarRun {
  const captures: IApiPostCapture[] = [];
  const stub = makeStubMediator({ responses: args.responses, captures });
  const jar = makeJarSpy(captures, COOKIES);
  const bus = args.hasSession === false ? stub : { ...stub, cookies: jar.session };
  const config = jarConfig(args.maxTokenChars);
  return { strategy: makeStrategy(config), bus, jar, captures };
}

/**
 * Creds carrying a stored token for an account.
 * @param token - Stored warm token ('' for none).
 * @param userCode - Account the creds name.
 * @returns Credentials.
 */
function credsWith(token: string, userCode = ACCOUNT): ScraperCredentials {
  return { otpLongTermToken: token, userCode } as unknown as ScraperCredentials;
}

/**
 * Every warning text logged so far.
 * @returns Serialised warn calls.
 */
function warnings(): string {
  return JSON.stringify(LOG.warn.mock.calls);
}

describe('cookie-jar warm start through the strategy', () => {
  it('imports the stored jar and resumes at fromStepIndex', async (): Promise<void> => {
    const run = makeRun({ responses: [STEP_OK] });
    const creds = credsWith(GOOD);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const wasWarm = run.strategy.lastPrimeWasWarm();
    const published = run.strategy.getLatestLongTermToken();
    expect(run.captures).toHaveLength(WARM_STEPS);
    expect(run.jar.events).toEqual([IMPORTED]);
    expect(wasWarm).toBe(true);
    expect(published).toBe(GOOD);
  });

  it('sends an imported cookie on the resumed request through the native transport', async () => {
    const cookie = { ...COOKIES[0], domain: 'example.test' };
    const stored = CODEC.encodeWarmJar(IDENTITY, [cookie]);
    assertOk(stored);
    const fake = fakeFetch((): Response => Response.json({ access_token: makeJwt(36000) }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    try {
      const bus = MEDIATOR.createHeadlessApiMediator({
        bankHint: CompanyTypes.OneZero,
        identityBaseUrl: 'https://example.test',
        graphqlUrl: 'https://example.test/graphql',
        sessionCookies: true,
        cookieDomains: ['example.test'],
      });
      const config = jarConfig();
      const strategy = makeStrategy(config);
      const creds = credsWith(stored.value);
      const result = await strategy.primeInitial(bus, CTX, creds);
      assertOk(result);
      const wasWarm = strategy.lastPrimeWasWarm();
      expect(wasWarm).toBe(true);
      expect(fake.calls).toHaveLength(WARM_STEPS);
      const headers = new Headers(fake.calls[0].init.headers);
      const sentCookie = headers.get('cookie');
      expect(sentCookie).toBe(`SMSESSION=${cookie.value}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each(['prefix', 'account'] as const)(
    'skips a %s-rejected token and runs cold',
    async (key): Promise<void> => {
      const token = REJECTED.find((row): boolean => row.reason === key)?.token ?? '';
      const run = makeRun({ responses: [STEP_OK, STEP_OK] });
      const creds = credsWith(token);
      const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
      assertOk(proc);
      const reason = CODEC.WARM_JAR_REJECTIONS[key];
      const logged = warnings();
      expect(run.captures).toHaveLength(COLD_STEPS);
      expect(run.jar.events).toEqual(['clear@0']);
      expect(logged).toContain(`warm start skipped: ${reason}`);
      expect(logged).not.toContain(token);
    },
  );

  it('skips the warm start when the bus has no cookie session', async (): Promise<void> => {
    const run = makeRun({ responses: [STEP_OK, STEP_OK], hasSession: false });
    const creds = credsWith(GOOD);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const reason = CODEC.WARM_JAR_REJECTIONS.session;
    const logged = warnings();
    expect(run.captures).toHaveLength(COLD_STEPS);
    expect(logged).toContain(`warm start skipped: ${reason}`);
  });

  it('skips the warm start when the creds name no account', async (): Promise<void> => {
    const run = makeRun({ responses: [STEP_OK, STEP_OK] });
    const creds = credsWith(GOOD, ' ');
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const reason = CODEC.WARM_JAR_REJECTIONS.unbound;
    const logged = warnings();
    expect(run.captures).toHaveLength(COLD_STEPS);
    expect(run.jar.events).toEqual(['clear@0']);
    expect(logged).toContain(`warm start skipped: ${reason}`);
  });

  it('clears the jar after a rejected resume, then runs one cold login', async (): Promise<void> => {
    const rejected = fail(ScraperErrorTypes.Generic, 'syn resume HTTP 401');
    const run = makeRun({ responses: [rejected, STEP_OK, STEP_OK] });
    const creds = credsWith(GOOD);
    const resolver = RESOLVER.buildResolverFromStrategy({
      strategy: run.strategy,
      bus: run.bus,
      ctx: CTX,
      creds,
    });
    const proc = await resolver.resolve();
    assertOk(proc);
    expect(run.captures).toHaveLength(WARM_STEPS + COLD_STEPS);
    expect(run.jar.events).toEqual([IMPORTED, CLEARED_AFTER_RESUME]);
  });

  it('publishes an exported jar of exactly maxTokenChars', async (): Promise<void> => {
    const run = makeRun({ responses: [STEP_OK, STEP_OK], maxTokenChars: GOOD.length });
    const creds = credsWith('');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    expect(published).toBe(GOOD);
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('publishes no token when the export is one char over', async (): Promise<void> => {
    const run = makeRun({ responses: [STEP_OK, STEP_OK], maxTokenChars: GOOD.length - 1 });
    const creds = credsWith('');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    const logged = warnings();
    expect(published).toBe('');
    expect(logged).toContain('warm start export skipped');
    expect(logged).not.toContain(MARKER);
  });

  it.each([
    { label: 'oversized', exported: GROWN_COOKIES, account: ACCOUNT },
    { label: 'unbound', exported: COOKIES, account: '' },
  ])('clears the previous token after an $label export', async ({ exported, account }) => {
    const run = makeRun({
      responses: [STEP_OK, STEP_OK, STEP_OK],
      maxTokenChars: GOOD.length,
    });
    const exportAll = jest
      .fn((): readonly IStoredCookie[] => exported)
      .mockReturnValueOnce(COOKIES);
    const bus = { ...run.bus, cookies: { ...run.jar.session, exportAll } };
    const initialCreds = credsWith(GOOD);
    const initial = await run.strategy.primeInitial(bus, CTX, initialCreds);
    assertOk(initial);
    const previous = run.strategy.getLatestLongTermToken();
    expect(previous).toBe(GOOD);
    const freshCreds = credsWith('', account);
    const refreshed = await run.strategy.primeFresh(bus, CTX, freshCreds);
    assertOk(refreshed);
    const published = run.strategy.getLatestLongTermToken();
    const logged = warnings();
    expect(published).toBe('');
    expect(logged).toContain('warm start export skipped');
    expect(logged).not.toContain(MARKER);
  });

  it('keeps a carry-kind token when the fresh flow does not replace it', async () => {
    const config = warmTwoStepConfig();
    const warmStart = {
      credsField: 'otpLongTermToken',
      carryField: 'refreshToken',
      fromStepIndex: 1,
    };
    const strategy = makeStrategy({ ...config, warmStart });
    const bus = makeStubMediator({ responses: [STEP_OK, STEP_OK, STEP_OK], captures: [] });
    const seed = makeJwt(36000);
    const creds = credsWith(seed);
    const initial = await strategy.primeInitial(bus, CTX, creds);
    assertOk(initial);
    const refreshed = await strategy.primeFresh(bus, CTX, creds);
    assertOk(refreshed);
    const published = strategy.getLatestLongTermToken();
    expect(published).toBe(seed);
  });

  it('publishes no token when the creds name no account', async (): Promise<void> => {
    const run = makeRun({ responses: [STEP_OK, STEP_OK] });
    const creds = credsWith('', '');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    const reason = CODEC.WARM_JAR_REJECTIONS.unbound;
    const logged = warnings();
    expect(published).toBe('');
    expect(logged).toContain(`warm start export skipped: ${reason}`);
    expect(logged).not.toContain(MARKER);
  });
});
