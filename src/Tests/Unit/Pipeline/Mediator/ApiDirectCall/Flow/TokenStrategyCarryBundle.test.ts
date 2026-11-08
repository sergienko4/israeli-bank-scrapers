/**
 * Carry-bundle warm start through the config strategy (UT-WBS).
 *
 * A stored bundle restores in order — the jar is imported, the carry slots
 * seed the flow, and the flow resumes at `fromStepIndex` — and a finished
 * login publishes its configured slots (and jar) as the next bundle. A token
 * failing any check, or a slot the login did not fill, is skipped with a
 * reason that never echoes a value. A cold start clears the jar and the client
 * cert before step 0, and `coldFallback: 'auth-rejected'` lets only a bank's
 * 401/403 to the warm resume escalate to a cold login. `cookieHandoff:
 * 'isolate'` empties the jar once the bundle is published. An in-run
 * recovery resumes from the stash and the private carry at
 * `fromStepIndex`; only an auth-rejected resume escalates to a cold login.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../../Scrapers/Base/Interface.js';
import { buildResolverFromStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js';
import type {
  CookieHandoff,
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IConfigTokenStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { failResponseIntegrity } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/ResponseIntegrityCheck.js';
import type { ICookieSession } from '../../../../../../Scrapers/Pipeline/Types/Domain/CookieSession.js';
import { RESPONSE_BYTE_LIMIT_REASON } from '../../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import {
  BANCS_URL,
  COOKIE_MARKER,
  type IJarSpy,
  makeDomainSession,
  makeJarSpy,
  WARM_COOKIES,
} from './WarmJarSpy.js';
import { makeJwt, WARM_STEP_TAG } from './WarmStartFixtures.js';

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
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCarryBundle.js');
const STRATEGY =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js');
const URLS = await import('../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js');

const CTX = { companyId: CompanyTypes.OneZero } as unknown as ITokenContext;
const PROVIDER = 'syn-bank';
const NUM = 'syn-num';
const NATIONAL_ID = 'syn-id';
const IDENTITY = { provider: PROVIDER, accounts: [NUM, NATIONAL_ID] } as const;
const LIMIT = 16384;
const LOGIN_CLIENT = `${COOKIE_MARKER}login-client`;
const STORED_CLIENT = `${COOKIE_MARKER}stored-client`;
const BEARER = makeJwt(36000);
/** A numeric field the cold-only step extracts — never a bundle slot value. */
const SERIAL = 7;
/** The cold-only step's answer: the client id the bundle keeps, and a bearer. */
const REGISTER_OK: Procedure<unknown> = succeed({
  client_id: LOGIN_CLIENT,
  access_token: BEARER,
  serial: SERIAL,
});
/** The token step's answer. */
const TOKEN_OK: Procedure<unknown> = succeed({ access_token: BEARER });
/** Steps a cold flow walks — the whole list. */
const COLD_STEPS = 2;
/** Steps a warm resume walks — everything from `fromStepIndex` on. */
const WARM_STEPS = 1;
/** The transport's prefix for a failed warm token request. */
const WARM_CALL = 'POST https://example.test/api/warm-tag';

/** The cold-only step: it fills the slot the bundle keeps. */
const REGISTER: IStepConfig = {
  name: 'register',
  urlTag: WARM_STEP_TAG,
  body: { shape: {} },
  extractsToCarry: { token: '/access_token', serial: '/serial' },
  optionalExtractsToCarry: {
    clientId: { pointer: '/client_id' },
    deviceId: { pointer: '/device_id' },
  },
};

/** The token step a warm resume starts at; it sends the kept slot. */
const LOGON: IStepConfig = {
  name: 'login',
  urlTag: WARM_STEP_TAG,
  body: { shape: { cid: { $ref: 'carry.clientId' } } },
  extractsToCarry: { token: '/access_token' },
};

/** What a bundle config varies. */
interface IBundleOpts {
  readonly maxTokenChars?: number;
  readonly hasCookies?: boolean;
  readonly slots?: readonly string[];
  readonly coldFallback?: 'any' | 'auth-rejected';
  readonly cookieHandoff?: CookieHandoff;
}

/**
 * Carry-bundle call config resuming at the token step.
 * @param opts - Ceiling, kept slots, jar, cold fallback and cookie hand-off.
 * @returns Call config.
 */
function bundleConfig(opts: IBundleOpts = {}): IApiDirectCallConfig {
  const warmStart = {
    kind: 'carry-bundle',
    credsField: 'otpLongTermToken',
    fromStepIndex: 1,
    validation: 'bank-call',
    provider: PROVIDER,
    accountFields: ['num', 'nationalID'],
    slots: opts.slots ?? ['clientId'],
    maxTokenChars: opts.maxTokenChars ?? LIMIT,
    cookies: opts.hasCookies ?? true,
    coldFallback: opts.coldFallback ?? 'any',
  } as const;
  const steps = [REGISTER, LOGON];
  const cookieHandoff = opts.cookieHandoff;
  const probe = { queryTag: 'customer' } as const;
  return { flow: 'sms-otp', envelope: {}, probe, steps, warmStart, cookieHandoff };
}

/**
 * Encode a bundle for the test identity.
 * @param clientId - Kept slot value.
 * @param hasCookies - Whether the bundle carries the jar.
 * @returns A `v1.` token.
 */
function bundleToken(clientId: string, hasCookies = true): string {
  const cookies = hasCookies ? WARM_COOKIES : false;
  const token = CODEC.encodeWarmBundle(IDENTITY, { carry: { clientId }, cookies });
  assertOk(token);
  return token.value;
}

const STORED = bundleToken(STORED_CLIENT);
/** What a cold login publishes: the login's slot and the jar it ends with. */
const PUBLISHED = bundleToken(LOGIN_CLIENT);

/** Strategy, bus, jar and request log for one run. */
interface IBundleRun {
  readonly strategy: IConfigTokenStrategy;
  readonly bus: ITokenBus;
  readonly jar: IJarSpy;
  readonly captures: IApiPostCapture[];
}

/** Inputs for one run. */
interface IBundleRunArgs extends IBundleOpts {
  readonly responses: readonly Procedure<unknown>[];
  readonly hasSession?: boolean;
  /** Cookie session to use instead of the spy's. */
  readonly session?: ICookieSession;
}

/**
 * Wire a strategy to a scripted bus carrying a spying jar.
 * @param args - Scripted answers, config options and whether the bus has a jar.
 * @returns The run's parts.
 */
function makeRun(args: IBundleRunArgs): IBundleRun {
  const captures: IApiPostCapture[] = [];
  const stub = makeStubMediator({ responses: args.responses, captures });
  const jar = makeJarSpy(captures, WARM_COOKIES);
  const cookies = args.session ?? jar.session;
  const bus = args.hasSession === false ? stub : { ...stub, cookies, clientCert: jar.cert };
  const config = bundleConfig(args);
  const proc = STRATEGY.createTokenStrategyFromConfig({ config });
  assertOk(proc);
  return { strategy: proc.value, bus, jar, captures };
}

/**
 * Creds carrying a stored token and the two account fields.
 * @param token - Stored warm token ('' for none).
 * @param num - Account number field.
 * @returns Credentials.
 */
function credsWith(token: string, num = NUM): ScraperCredentials {
  const creds = { otpLongTermToken: token, num, nationalID: NATIONAL_ID };
  return creds as unknown as ScraperCredentials;
}

/**
 * Every warning text logged so far.
 * @returns Serialised warn calls.
 */
function warnings(): string {
  return JSON.stringify(LOG.warn.mock.calls);
}

/**
 * The client id the first captured request sent.
 * @param captures - Captured requests.
 * @returns The body's `cid`, or ''.
 */
function sentClient(captures: readonly IApiPostCapture[]): string {
  const first = captures.at(0);
  const body = (first?.body ?? {}) as Readonly<Record<string, unknown>>;
  const cid = body.cid;
  return typeof cid === 'string' ? cid : '';
}

/**
 * Resolve through the retry ladder, as the mediator does.
 * @param run - The run's parts.
 * @param creds - Credentials.
 * @returns The header value, or the failure the ladder returned.
 */
async function resolveVia(run: IBundleRun, creds: ScraperCredentials): Promise<Procedure<string>> {
  const deps = { strategy: run.strategy, bus: run.bus, ctx: CTX, creds };
  const resolver = buildResolverFromStrategy(deps);
  return resolver.resolve();
}

beforeAll((): void => {
  URLS.registerWkUrl(WARM_STEP_TAG, CompanyTypes.OneZero, 'https://example.test/api/warm-tag');
});

beforeEach((): void => {
  LOG.warn.mockClear();
});

describe('carry-bundle warm restore', () => {
  it('imports the jar, seeds the carry and resumes at fromStepIndex', async (): Promise<void> => {
    const run = makeRun({ responses: [TOKEN_OK] });
    const creds = credsWith(STORED);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const wasWarm = run.strategy.lastPrimeWasWarm();
    const sent = sentClient(run.captures);
    expect(run.captures).toHaveLength(WARM_STEPS);
    expect(run.jar.events).toEqual([`import${String(WARM_COOKIES.length)}@0`]);
    expect(sent).toBe(STORED_CLIENT);
    expect(wasWarm).toBe(true);
  });

  it('seeds the carry alone when the bundle keeps no jar', async (): Promise<void> => {
    const run = makeRun({ responses: [TOKEN_OK], hasCookies: false, hasSession: false });
    const stored = bundleToken(STORED_CLIENT, false);
    const creds = credsWith(stored);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const sent = sentClient(run.captures);
    expect(run.captures).toHaveLength(WARM_STEPS);
    expect(sent).toBe(STORED_CLIENT);
  });

  it.each<[string, string, keyof typeof CODEC.WARM_BUNDLE_REJECTIONS]>([
    ['another account', 'syn-other', 'account'],
    ['a blank account', ' ', 'unbound'],
  ])('skips a token for %s and runs cold', async (_label, num, key): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK] });
    const creds = credsWith(STORED, num);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const reason = CODEC.WARM_BUNDLE_REJECTIONS[key];
    const logged = warnings();
    expect(run.captures).toHaveLength(COLD_STEPS);
    expect(logged).toContain(`warm start skipped: ${reason}`);
    expect(logged).not.toContain(STORED);
  });

  it('skips a jar-keeping bundle when the bus has no cookie session', async (): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK], hasSession: false });
    const creds = credsWith(STORED);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const reason = CODEC.WARM_BUNDLE_REJECTIONS.session;
    const logged = warnings();
    expect(run.captures).toHaveLength(COLD_STEPS);
    expect(logged).toContain(`warm start skipped: ${reason}`);
  });
});

describe('carry-bundle warm export', () => {
  it('publishes the login slots and jar at exactly maxTokenChars', async (): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK], maxTokenChars: PUBLISHED.length });
    const creds = credsWith('');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    expect(published).toBe(PUBLISHED);
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('publishes no jar when the bundle keeps none', async (): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK], hasCookies: false });
    const creds = credsWith('');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    const expected = bundleToken(LOGIN_CLIENT, false);
    expect(published).toBe(expected);
  });

  it('publishes no token when the export is one char over', async (): Promise<void> => {
    const maxTokenChars = PUBLISHED.length - 1;
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK], maxTokenChars });
    const creds = credsWith('');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    const logged = warnings();
    expect(published).toBe('');
    expect(logged).toContain('warm start export skipped: over maxTokenChars');
    expect(logged).not.toContain(COOKIE_MARKER);
  });

  it.each<[string, string]>([
    ['absent', 'deviceId'],
    ['not text', 'serial'],
  ])('publishes no token when a kept slot is %s', async (_label, slot): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK], slots: [slot] });
    const creds = credsWith('');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    const logged = warnings();
    expect(published).toBe('');
    expect(logged).toContain(`warm start export skipped: slot ${slot} is not filled`);
    expect(logged).not.toContain(COOKIE_MARKER);
    expect(logged).not.toContain(BEARER);
  });
});

describe('carry-bundle cold start', () => {
  it('clears the jar and the client cert before step 0', async (): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK] });
    const creds = credsWith('');
    const proc = await run.strategy.primeFresh(run.bus, CTX, creds);
    assertOk(proc);
    expect(run.jar.events).toEqual(['clear@0', 'cert-clear@0']);
  });

  it('never sends a restored slot after a rejected warm start', async (): Promise<void> => {
    const warmReject = fail(ScraperErrorTypes.Generic, `${WARM_CALL} 401: denied`);
    const registerNoClient = succeed({ access_token: BEARER, serial: SERIAL });
    const responses = [warmReject, registerNoClient, TOKEN_OK];
    const run = makeRun({ responses, coldFallback: 'auth-rejected' });
    const creds = credsWith(STORED);
    await resolveVia(run, creds);
    const coldRequests = run.captures.slice(WARM_STEPS);
    const sent = JSON.stringify(coldRequests);
    expect(coldRequests.length).toBeGreaterThan(0);
    expect(sent).not.toContain(STORED_CLIENT);
  });
});

describe('carry-bundle coldFallback', () => {
  it.each<[string]>([['401'], ['403']])(
    'auth-rejected: a warm token step answered %s runs one cold login',
    async (status): Promise<void> => {
      const warmReject = fail(ScraperErrorTypes.Generic, `${WARM_CALL} ${status}: denied`);
      const responses = [warmReject, REGISTER_OK, TOKEN_OK];
      const run = makeRun({ responses, coldFallback: 'auth-rejected' });
      const creds = credsWith(STORED);
      const proc = await resolveVia(run, creds);
      assertOk(proc);
      const imported = `import${String(WARM_COOKIES.length)}@0`;
      expect(run.captures).toHaveLength(WARM_STEPS + COLD_STEPS);
      expect(run.jar.events).toEqual([imported, 'clear@1', 'cert-clear@1']);
    },
  );

  it.each<[string, Procedure<unknown>, string]>([
    ['400', fail(ScraperErrorTypes.Generic, `${WARM_CALL} 400: bad`), 'login HTTP 400'],
    ['500', fail(ScraperErrorTypes.Generic, `${WARM_CALL} 500: oops`), 'login HTTP 500'],
    ['a timeout', fail(ScraperErrorTypes.Timeout, `${WARM_CALL} timed out`), 'login TIMEOUT'],
  ])(
    'auth-rejected: a warm token step answered %s returns it with no cold call',
    async (_label, warmFail, errorMessage): Promise<void> => {
      const run = makeRun({ responses: [warmFail], coldFallback: 'auth-rejected' });
      const creds = credsWith(STORED);
      const proc = await resolveVia(run, creds);
      const imported = `import${String(WARM_COOKIES.length)}@0`;
      expect(proc).toMatchObject({ success: false, errorMessage });
      expect(run.captures).toHaveLength(WARM_STEPS);
      expect(run.jar.events).toEqual([imported]);
    },
  );

  it('auth-rejected: a token that fails to decode still runs cold', async (): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK], coldFallback: 'auth-rejected' });
    const creds = credsWith(STORED, 'syn-other');
    const proc = await resolveVia(run, creds);
    assertOk(proc);
    expect(run.captures).toHaveLength(COLD_STEPS);
  });

  it('any: a warm token step answered 500 still runs one cold login', async (): Promise<void> => {
    const warmFail = fail(ScraperErrorTypes.Generic, `${WARM_CALL} 500: oops`);
    const run = makeRun({ responses: [warmFail, REGISTER_OK, TOKEN_OK] });
    const creds = credsWith(STORED);
    const proc = await resolveVia(run, creds);
    assertOk(proc);
    expect(run.captures).toHaveLength(WARM_STEPS + COLD_STEPS);
  });
});

describe('carry-bundle cookie hand-off', () => {
  it('isolate: publishes the gateway cookies, then no BaNCS read is sent them', async (): Promise<void> => {
    const domain = makeDomainSession();
    const session = domain.session;
    const run = makeRun({ responses: [TOKEN_OK], cookieHandoff: 'isolate', session });
    const creds = credsWith(STORED);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const published = run.strategy.getLatestLongTermToken();
    const restoredWithJar = bundleToken(STORED_CLIENT);
    const left = domain.jar.exportAll();
    const bancsHeader = domain.jar.header(BANCS_URL);
    expect(published).toBe(restoredWithJar);
    expect(left).toEqual([]);
    expect(bancsHeader).toBe('');
  });

  it('shared: the gateway cookies stay in the jar for the scrape', async (): Promise<void> => {
    const domain = makeDomainSession();
    const run = makeRun({ responses: [TOKEN_OK], session: domain.session });
    const creds = credsWith(STORED);
    const proc = await run.strategy.primeInitial(run.bus, CTX, creds);
    assertOk(proc);
    const left = domain.jar.exportAll();
    const bancsHeader = domain.jar.header(BANCS_URL);
    expect(left).toEqual(WARM_COOKIES);
    expect(bancsHeader).toContain('SMSESSION=');
  });
});

/**
 * Mint the run's first session, then re-grant it the way a whole-scrape
 * recovery does, noting the jar events the recovery alone caused.
 * @param run - Bundle run under test.
 * @param creds - Creds the run logs in with.
 * @returns The recovery's procedure and its jar events.
 */
async function primeThenRecover(
  run: IBundleRun,
  creds: ScraperCredentials,
): Promise<{ proc: Procedure<string>; events: readonly string[] }> {
  const first = await run.strategy.primeInitial(run.bus, CTX, creds);
  assertOk(first);
  const before = run.jar.events.length;
  const proc = await run.strategy.primeRecover(run.bus, CTX, creds);
  const events = run.jar.events.slice(before);
  return { proc, events };
}

describe('carry-bundle in-run recovery', () => {
  const integrityRefusal = failResponseIntegrity(RESPONSE_BYTE_LIMIT_REASON);
  const wafRefusal = fail(ScraperErrorTypes.WafBlocked, 'edge refusal');

  it.each([
    ['integrity', integrityRefusal],
    ['WAF', wafRefusal],
  ])('does not cold-login after a %s refusal when budget remains', async (_label, refusal) => {
    const responses = [TOKEN_OK, refusal, REGISTER_OK, TOKEN_OK];
    const run = makeRun({ responses, coldFallback: 'any' });
    const warmCreds = credsWith(STORED);
    const { proc } = await primeThenRecover(run, warmCreds);
    expect(proc).toEqual(refusal);
    expect(run.captures).toHaveLength(WARM_STEPS + WARM_STEPS);
  });

  it.each([
    ['integrity', integrityRefusal],
    ['WAF', wafRefusal],
  ])(
    'does not return an old header after a %s refusal when budget is spent',
    async (_label, refusal) => {
      const responses = [REGISTER_OK, TOKEN_OK, refusal];
      const run = makeRun({ responses, coldFallback: 'any' });
      const coldCreds = credsWith('');
      const { proc } = await primeThenRecover(run, coldCreds);
      expect(proc).toEqual(refusal);
      expect(run.captures).toHaveLength(COLD_STEPS + WARM_STEPS);
    },
  );

  it('resumes from the stash and the private carry at fromStepIndex', async (): Promise<void> => {
    const responses = [REGISTER_OK, TOKEN_OK, TOKEN_OK];
    const run = makeRun({ responses, cookieHandoff: 'isolate' });
    const coldCreds = credsWith('');
    const { proc, events } = await primeThenRecover(run, coldCreds);
    assertOk(proc);
    const resumedCalls = run.captures.slice(COLD_STEPS);
    const sent = sentClient(resumedCalls);
    const isResumed = run.strategy.lastRecoveryResumed?.();
    const imported = `import${String(WARM_COOKIES.length)}@${String(COLD_STEPS)}`;
    expect(resumedCalls).toHaveLength(WARM_STEPS);
    expect(sent).toBe(LOGIN_CLIENT);
    expect(events).toEqual([`clear@${String(COLD_STEPS)}`, imported, 'clear@3']);
    expect(isResumed).toBe(true);
  });

  it('shared: resumes on the jar the scrape already holds', async (): Promise<void> => {
    const run = makeRun({ responses: [REGISTER_OK, TOKEN_OK, TOKEN_OK] });
    const coldCreds = credsWith('');
    const { proc, events } = await primeThenRecover(run, coldCreds);
    assertOk(proc);
    const resumedCalls = run.captures.slice(COLD_STEPS);
    const sent = sentClient(resumedCalls);
    expect(resumedCalls).toHaveLength(WARM_STEPS);
    expect(sent).toBe(LOGIN_CLIENT);
    expect(events).toEqual([]);
  });

  it('auth-rejected: a resume answered 401 runs one cold login', async (): Promise<void> => {
    const resumeReject = fail(ScraperErrorTypes.Generic, `${WARM_CALL} 401: denied`);
    const responses = [TOKEN_OK, resumeReject, REGISTER_OK, TOKEN_OK];
    const opts = { responses, coldFallback: 'auth-rejected', cookieHandoff: 'isolate' } as const;
    const run = makeRun(opts);
    const warmCreds = credsWith(STORED);
    const { proc } = await primeThenRecover(run, warmCreds);
    assertOk(proc);
    const isResumed = run.strategy.lastRecoveryResumed?.();
    expect(run.captures).toHaveLength(WARM_STEPS + WARM_STEPS + COLD_STEPS);
    expect(isResumed).toBe(false);
  });

  it('auth-rejected: a resume answered 500 returns it with no cold call', async (): Promise<void> => {
    const resumeFail = fail(ScraperErrorTypes.Generic, `${WARM_CALL} 500: oops`);
    const opts = { coldFallback: 'auth-rejected', cookieHandoff: 'isolate' } as const;
    const run = makeRun({ ...opts, responses: [TOKEN_OK, resumeFail] });
    const warmCreds = credsWith(STORED);
    const { proc } = await primeThenRecover(run, warmCreds);
    expect(proc).toMatchObject({ success: false, errorMessage: 'login HTTP 500' });
    expect(run.captures).toHaveLength(WARM_STEPS + WARM_STEPS);
  });
});
