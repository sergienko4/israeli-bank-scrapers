/**
 * ACTION-phase regression for the warm-session flag (F4 — drives F1).
 *
 * Pins that the ApiDirectCall ACTION stage records `setSessionWarm` from
 * the ACTUAL prime path, not from mere cached-token presence. A stale
 * cached JWT runs the COLD flow (it already spent an OTP legitimately)
 * and MUST record warm=false; otherwise a later degraded scrape fires a
 * spec-forbidden second OTP. A fresh cached JWT short-circuits warm and
 * records warm=true; an absent token runs cold and records warm=false.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../Scrapers/Base/Interface.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import { runApiDirectCallAction } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.action.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlGroup } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenContext } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { type IApiPostCapture, makeStubMediator } from './Flow/StubMediator.js';

const ASSERT_TAG: WKUrlGroup = 'auth.assert';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(ASSERT_TAG, HINT, 'https://example.test/api/assert-warmflag');
});

/** Captured (strategy, ctx, creds) from a withTokenStrategy registration. */
interface ICaptured {
  readonly strategy: ITokenStrategy<Record<string, unknown>>;
  readonly ctx: ITokenContext;
  readonly creds: Record<string, unknown>;
}

/** A recording bus plus the slots tests assert on. */
interface IWarmRecorder {
  readonly bus: IApiMediator;
  readonly warmCalls: boolean[];
  readonly captures: IApiPostCapture[];
}

/**
 * Build a synthetic JWT with a configurable `exp` claim offset.
 * @param deltaSec - Seconds from now for the exp claim (negative = stale).
 * @returns Compact JWT.
 */
function makeJwt(deltaSec: number): string {
  const headerJson = JSON.stringify({ alg: 'none' });
  const headerEnc = Buffer.from(headerJson).toString('base64url');
  const expSec = Math.floor(Date.now() / 1000) + deltaSec;
  const payloadJson = JSON.stringify({ exp: expSec });
  const payloadEnc = Buffer.from(payloadJson).toString('base64url');
  return `${headerEnc}.${payloadEnc}.sig`;
}

/**
 * Build the warm+jwtClaims config used by every case (single cold step).
 * @returns API-direct-call config literal.
 */
function warmConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: { queryTag: 'customer' },
    warmStart: { credsField: 'otpLongTermToken', carryField: 'token', fromStepIndex: 1 },
    jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
    steps: [
      {
        name: 'getIdToken',
        urlTag: ASSERT_TAG,
        body: { shape: {} },
        extractsToCarry: { token: '/access_token' },
      },
    ],
  };
}

/**
 * Record a `setSessionWarm` invocation into the sink.
 * @param sink - Output slot for recorded flags.
 * @param value - The warm flag the ACTION stage recorded.
 * @returns true (ack contract).
 */
function recordWarm(sink: boolean[], value: boolean): true {
  sink.push(value);
  return true;
}

/**
 * Run the captured strategy's primeInitial against the scripted bus.
 * @param base - Stub bus whose apiPost dequeues scripted cold responses.
 * @param sink - Single-slot sink holding the captured registration.
 * @returns Header-value procedure from the real prime path.
 */
async function primeCaptured(base: IApiMediator, sink: ICaptured[]): Promise<Procedure<string>> {
  if (sink.length === 0) return fail(ScraperErrorTypes.Generic, 'no strategy registered');
  const captured = sink[0];
  return captured.strategy.primeInitial(base, captured.ctx, captured.creds);
}

/**
 * Capture a withTokenStrategy registration into the single-slot sink.
 * @param sink - Output slot receiving the registration.
 * @param captured - The strategy/ctx/creds registered by the ACTION stage.
 * @returns true (ack contract).
 */
function captureStrategy(sink: ICaptured[], captured: ICaptured): true {
  sink[0] = captured;
  return true;
}

/**
 * Build a bus that records the warm flag and routes primeSession through
 * the REAL strategy's primeInitial so `usedWarmPath` is set authentically.
 * @param coldResponses - Scripted apiPost responses for the cold flow.
 * @returns Recording bus + assertion slots.
 */
function makeWarmRecordingBus(coldResponses: readonly Procedure<unknown>[]): IWarmRecorder {
  const warmCalls: boolean[] = [];
  const captures: IApiPostCapture[] = [];
  const base = makeStubMediator({ responses: coldResponses, captures });
  const sink: ICaptured[] = [];
  const bus: IApiMediator = {
    ...base,
    /**
     * Capture the strategy registration for a later real prime.
     * @param strategy - The token strategy registered by the ACTION stage.
     * @param ctx - The token context paired with the strategy.
     * @param creds - The credentials paired with the strategy.
     * @returns true (ack contract).
     */
    withTokenStrategy: <TCreds>(
      strategy: ITokenStrategy<TCreds>,
      ctx: ITokenContext,
      creds: TCreds,
    ): true =>
      captureStrategy(sink, {
        strategy: strategy as ITokenStrategy<Record<string, unknown>>,
        ctx,
        creds: creds as Record<string, unknown>,
      }),
    /**
     * Route primeSession through the captured real strategy.
     * @returns Header-value procedure from the real prime path.
     */
    primeSession: (): Promise<Procedure<string>> => primeCaptured(base, sink),
    /**
     * Record the warm flag the ACTION stage set.
     * @param value - The warm flag recorded by the ACTION stage.
     * @returns true (ack contract).
     */
    setSessionWarm: (value: boolean): true => recordWarm(warmCalls, value),
  };
  return { bus, warmCalls, captures };
}

/**
 * Assemble a mock context wired to the recording bus + given cached token.
 * @param rec - The recording bus.
 * @param token - Optional cached long-term JWT.
 * @returns Mock pipeline context.
 */
function ctxFor(rec: IWarmRecorder, token?: string): ReturnType<typeof makeMockContext> {
  const creds = { username: 'fixt-u', password: 'fixt-p', otpLongTermToken: token };
  return makeMockContext({
    companyId: HINT,
    apiMediator: some(rec.bus),
    credentials: creds as ScraperCredentials,
  });
}

describe('ApiDirectCall ACTION records the warm flag from the actual prime path', () => {
  it('records warm=false when the cached JWT is stale (cold flow runs)', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const staleJwt = makeJwt(-10);
    const ctx = ctxFor(rec, staleJwt);
    const config = warmConfig();
    const result = await runApiDirectCallAction(config, ctx);
    const wasWarm = rec.warmCalls.at(-1);
    expect(result.success).toBe(true);
    expect(wasWarm).toBe(false);
    expect(rec.captures).toHaveLength(1);
  });

  it('records warm=true when the cached JWT is fresh (warm short-circuit)', async () => {
    const rec = makeWarmRecordingBus([]);
    const freshJwt = makeJwt(3600);
    const ctx = ctxFor(rec, freshJwt);
    const config = warmConfig();
    const result = await runApiDirectCallAction(config, ctx);
    const wasWarm = rec.warmCalls.at(-1);
    expect(result.success).toBe(true);
    expect(wasWarm).toBe(true);
    expect(rec.captures).toHaveLength(0);
  });

  it('records warm=false when no cached token is present (cold flow)', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const ctx = ctxFor(rec);
    const config = warmConfig();
    const result = await runApiDirectCallAction(config, ctx);
    const wasWarm = rec.warmCalls.at(-1);
    expect(result.success).toBe(true);
    expect(wasWarm).toBe(false);
    expect(rec.captures).toHaveLength(1);
  });
});
