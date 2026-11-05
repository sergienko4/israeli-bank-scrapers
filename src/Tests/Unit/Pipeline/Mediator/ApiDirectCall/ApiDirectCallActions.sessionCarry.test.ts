/**
 * N32 — the ACTION stage installs only the flow's `sessionCarry` slots as
 * the scrape's session context: after the initial prime, and again when the
 * recovery hook fires, replacing every value the scrape patched in between.
 * Without an allowlist the full carry snapshot is installed.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiMediator,
  RecoveredHook,
  SessionContext,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import { buildResolverFromStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js';
import { runApiDirectCallAction } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.action.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { WKUrlGroup } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenContext } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { type IApiPostCapture, makeStubMediator } from './Flow/StubMediator.js';

const HINT = CompanyTypes.OneZero;
const LOGIN_TAG: WKUrlGroup = 'auth.assert';

beforeAll((): void => {
  registerWkUrl(LOGIN_TAG, HINT, 'https://example.test/api/session-carry-login');
});

const LOGIN_REPLY = { access_token: 'access-token', mag: 'mag-value', client_secret: 'secret' };
const EXTRACTED = { token: 'access-token', mag: 'mag-value', clientSecret: 'secret' };
const MAG_ONLY = { mag: 'mag-value' };
const BANCS_SESSION = { security: 's', csrf: 'c', session: 'j', xsrf: 'x', mag: 'stale' };

/** The strategy registration the ACTION stage hands the bus. */
interface IRegistration {
  readonly strategy: ITokenStrategy<Record<string, unknown>>;
  readonly ctx: ITokenContext;
  readonly creds: Record<string, unknown>;
}

/** A bus that primes through the real strategy, plus its recorded hooks. */
interface ISessionRecorder {
  readonly bus: IApiMediator;
  readonly hooks: RecoveredHook[];
}

/** Session-context slot the recording bus replaces on every install. */
interface ISessionSlot {
  current: SessionContext;
}

/**
 * Login config whose one step carries a token, a session value and a secret.
 * @param sessionCarry - Optional allowlist.
 * @returns Call config.
 */
function configWith(sessionCarry?: readonly string[]): IApiDirectCallConfig {
  const extractsToCarry = { token: '/access_token', mag: '/mag', clientSecret: '/client_secret' };
  const step = { name: 'login', urlTag: LOGIN_TAG, body: { shape: {} }, extractsToCarry } as const;
  const config: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [step] };
  if (sessionCarry === undefined) return config;
  return { ...config, sessionCarry };
}

/**
 * Run the registered strategy through the real resolver.
 * @param base - Stub bus whose apiPost answers the login step.
 * @param sink - Single-slot registration sink.
 * @returns Header-value procedure.
 */
async function primeRegistered(
  base: IApiMediator,
  sink: IRegistration[],
): Promise<Procedure<string>> {
  if (sink.length === 0) return fail(ScraperErrorTypes.Generic, 'no strategy registered');
  const { strategy, ctx, creds } = sink[0];
  const resolver = buildResolverFromStrategy({ strategy, bus: base, ctx, creds });
  return resolver.resolve();
}

/**
 * Replace the session slot, as the real mediator's `setSessionContext` does.
 * @param slot - Session slot.
 * @param next - Context to install.
 * @returns true (ack contract).
 */
function replaceSession(slot: ISessionSlot, next: SessionContext): true {
  slot.current = next;
  return true;
}

/**
 * Build a bus that primes through the real strategy and records hooks.
 * @returns Recording bus + hook sink.
 */
function makeSessionRecorder(): ISessionRecorder {
  const captures: IApiPostCapture[] = [];
  const reply = succeed(LOGIN_REPLY);
  const base = makeStubMediator({ responses: [reply], captures });
  const sink: IRegistration[] = [];
  const hooks: RecoveredHook[] = [];
  const slot: ISessionSlot = { current: {} };
  const bus: IApiMediator = {
    ...base,
    /**
     * Install a session context, replacing the previous one.
     * @param next - Context to install.
     * @returns true (ack contract).
     */
    setSessionContext: (next: SessionContext): true => replaceSession(slot, next),
    /**
     * Read the installed session context.
     * @returns The current context.
     */
    getSessionContext: (): SessionContext => slot.current,
    /**
     * Record the strategy registration for the real prime.
     * @param strategy - Token strategy.
     * @param ctx - Token context.
     * @param creds - Credentials.
     * @returns true (ack contract).
     */
    withTokenStrategy: <TCreds>(
      strategy: ITokenStrategy<TCreds>,
      ctx: ITokenContext,
      creds: TCreds,
    ): true => {
      const registered = strategy as ITokenStrategy<Record<string, unknown>>;
      sink[0] = { strategy: registered, ctx, creds: creds as Record<string, unknown> };
      return true;
    },
    /**
     * Prime through the registered strategy.
     * @returns Header-value procedure.
     */
    primeSession: (): Promise<Procedure<string>> => primeRegistered(base, sink),
    /**
     * Record the recovery hook.
     * @param hook - Hook fired after a recovery.
     * @returns true (ack contract).
     */
    withRecoveryHook: (hook: RecoveredHook): true => {
      hooks.push(hook);
      return true;
    },
  };
  return { bus, hooks };
}

/**
 * Pipeline context wired to the recording bus.
 * @param bus - Recording bus.
 * @returns Mock pipeline context.
 */
function ctxFor(bus: IApiMediator): IPipelineContext {
  const apiMediator = some(bus);
  return makeMockContext({ companyId: HINT, apiMediator });
}

describe('ApiDirectCallActions ACTION stage — session carry (N32)', () => {
  it('installs exactly the allowlisted slots after the initial prime', async () => {
    const rec = makeSessionRecorder();
    const ctx = ctxFor(rec.bus);
    const config = configWith(['mag']);
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(true);
    const session = rec.bus.getSessionContext();
    expect(session).toEqual(MAG_ONLY);
  });

  it('installs the full carry snapshot, secrets included, without an allowlist', async () => {
    const rec = makeSessionRecorder();
    const ctx = ctxFor(rec.bus);
    const config = configWith();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(true);
    const session = rec.bus.getSessionContext();
    expect(session).toMatchObject(EXTRACTED);
  });

  it('replaces every earlier value with the allowlisted slots on recovery', async () => {
    const rec = makeSessionRecorder();
    const ctx = ctxFor(rec.bus);
    const config = configWith(['mag']);
    await runApiDirectCallAction(config, ctx);
    rec.bus.setSessionContext(BANCS_SESSION);
    expect(rec.hooks).toHaveLength(1);
    const [hook] = rec.hooks;
    const wasWarm = false;
    await hook('access-token', wasWarm);
    const session = rec.bus.getSessionContext();
    expect(session).toEqual(MAG_ONLY);
  });
});
