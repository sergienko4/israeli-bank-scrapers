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

import { PassThrough } from 'node:stream';

import pino from 'pino';

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../Scrapers/Base/Interface.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Logging/Debug.js';
import type {
  IApiMediator,
  RecoveredHook,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
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
  readonly hooks: RecoveredHook[];
  readonly sink: ICaptured[];
  readonly base: IApiMediator;
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
 * Capture the recovery hook the ACTION stage installs on the bus.
 * @param sink - Output slot receiving the hook.
 * @param hook - Hook fired by the mediator after a cold recovery.
 * @returns true (ack contract).
 */
function captureHook(sink: RecoveredHook[], hook: RecoveredHook): true {
  sink.push(hook);
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
  const hooks: RecoveredHook[] = [];
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
    /**
     * Read back the last recorded warm flag, as the real mediator does —
     * `setSessionWarm` writes the state `wasSessionWarm` reads.
     * @returns The most recently recorded warm flag.
     */
    wasSessionWarm: (): boolean => warmCalls.at(-1) ?? false,
    /**
     * Capture the recovery hook installed by the ACTION stage.
     * @param hook - Hook the mediator fires after a cold recovery.
     * @returns true (ack contract).
     */
    withRecoveryHook: (hook: RecoveredHook): true => captureHook(hooks, hook),
  };
  return { bus, warmCalls, captures, hooks, sink, base };
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

/** A logger plus the buffer capturing everything it emitted. */
interface ILogRecorder {
  readonly logger: ScraperLogger;
  readonly read: () => string;
}

/**
 * Build a real pino logger writing into an in-memory buffer.
 * @returns Logger plus a reader for the emitted lines.
 */
function makeLogRecorder(): ILogRecorder {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const logger = pino({ level: 'warn' }, stream);
  return {
    logger,
    /**
     * Read everything the logger has emitted so far.
     * @returns Accumulated log output.
     */
    read: (): string => output,
  };
}

/**
 * Run the ACTION stage against a recording logger.
 * @param rec - The recording bus.
 * @param token - Optional cached long-term JWT.
 * @returns The emitted log output plus the action's procedure result.
 */
async function runWithLogRecorder(
  rec: IWarmRecorder,
  token?: string,
): Promise<{ logs: string; result: Procedure<unknown>; readLogs: () => string }> {
  const recorder = makeLogRecorder();
  const base = ctxFor(rec, token);
  const ctx = { ...base, logger: recorder.logger };
  const config = warmConfig();
  const result = await runApiDirectCallAction(config, ctx);
  const logs = recorder.read();
  return { logs, result, readLogs: recorder.read };
}

/** Text the degradation warning must contain to be actionable. */
const FALLBACK_WARNING = 'stored long-term token was not accepted';

/** Long-term token the scripted cold recovery mints as a replacement. */
const RECOVERED_TOKEN = 'recovered-long-term-tok';

/**
 * Read the durable token the ACTION stage published onto the context.
 * @param result - Procedure returned by the ACTION stage.
 * @returns The published token, or '' when the slot is absent.
 */
function durableTokenOf(result: Procedure<IPipelineContext>): string {
  if (!result.success) return '';
  const slot = result.value.durableAuth;
  return slot.has ? slot.value.persistentOtpToken : '';
}

/**
 * Count how many times the degradation warning appears in captured logs.
 * @param logs - Accumulated log output.
 * @returns Number of occurrences.
 */
function countWarnings(logs: string): number {
  return logs.split(FALLBACK_WARNING).length - 1;
}

/**
 * Drive a cold recovery exactly as `ApiMediator.retry` does: mint a
 * replacement through the captured strategy's `primeFresh`, capture the
 * warmth, flip the session cold, then fire the recovery hook the ACTION
 * stage installed — in that order, because the real `recoverSessionOp`
 * clears the flag before the hook runs.
 * @param rec - The recording bus holding the capture slots.
 * @returns The header the recovery produced.
 */
async function recoverColdly(rec: IWarmRecorder): Promise<string> {
  const captured = rec.sink[0];
  const primed = await captured.strategy.primeFresh(rec.base, captured.ctx, captured.creds);
  const header = primed.success ? primed.value : '';
  const wasWarm = rec.bus.wasSessionWarm();
  rec.bus.setSessionWarm(false);
  await rec.hooks[0](header, wasWarm);
  return header;
}

describe('ApiDirectCall ACTION keeps the durable token current after cold recovery', () => {
  it('publishes the warm token while the warm session still holds', async () => {
    const rec = makeWarmRecordingBus([]);
    const freshJwt = makeJwt(3600);
    const ctx = ctxFor(rec, freshJwt);
    const config = warmConfig();
    const result = await runApiDirectCallAction(config, ctx);
    const published = durableTokenOf(result);
    expect(published).toBe(freshJwt);
  });

  it('republishes the replacement token once cold recovery mints one', async () => {
    const recovered = succeed({ access_token: RECOVERED_TOKEN });
    const rec = makeWarmRecordingBus([recovered]);
    const freshJwt = makeJwt(3600);
    const ctx = ctxFor(rec, freshJwt);
    const config = warmConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(rec.hooks).toHaveLength(1);
    await recoverColdly(rec);
    const republished = durableTokenOf(result);
    expect(republished).toBe(RECOVERED_TOKEN);
  });

  it('warns when cold recovery replaces a warm session mid-run', async () => {
    const recovered = succeed({ access_token: RECOVERED_TOKEN });
    const rec = makeWarmRecordingBus([recovered]);
    const freshJwt = makeJwt(3600);
    const run = await runWithLogRecorder(rec, freshJwt);
    expect(run.logs).not.toContain(FALLBACK_WARNING);
    await recoverColdly(rec);
    const after = run.readLogs();
    expect(after).toContain(FALLBACK_WARNING);
  });

  it('does not re-blame the stored token when the session was already cold', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const recovered = succeed({ access_token: RECOVERED_TOKEN });
    const rec = makeWarmRecordingBus([coldTok, recovered]);
    const staleJwt = makeJwt(-10);
    const run = await runWithLogRecorder(rec, staleJwt);
    const coldWarnings = countWarnings(run.logs);
    expect(coldWarnings).toBe(1);
    await recoverColdly(rec);
    const laterLogs = run.readLogs();
    const afterWarnings = countWarnings(laterLogs);
    expect(afterWarnings).toBe(1);
  });
});

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

  it('warns when a stored token was supplied but the cold SMS flow ran', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const staleJwt = makeJwt(-10);
    const { logs, result } = await runWithLogRecorder(rec, staleJwt);
    expect(result.success).toBe(true);
    expect(logs).toContain(FALLBACK_WARNING);
  });

  it('stays quiet when no token was stored, since nothing degraded', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const { logs, result } = await runWithLogRecorder(rec);
    expect(result.success).toBe(true);
    expect(logs).not.toContain(FALLBACK_WARNING);
  });

  it('stays quiet when the warm path actually succeeded', async () => {
    const rec = makeWarmRecordingBus([]);
    const freshJwt = makeJwt(3600);
    const { logs, result } = await runWithLogRecorder(rec, freshJwt);
    expect(result.success).toBe(true);
    expect(logs).not.toContain(FALLBACK_WARNING);
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
