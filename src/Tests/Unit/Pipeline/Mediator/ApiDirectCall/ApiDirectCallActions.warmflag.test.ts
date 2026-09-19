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
import { buildResolverFromStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js';
import { runApiDirectCallAction } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.action.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenContext } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { type IApiPostCapture, makeStubMediator } from './Flow/StubMediator.js';
import { makeJwt, WARM_STEP_TAG, warmConfig, warmTwoStepConfig } from './Flow/WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(WARM_STEP_TAG, HINT, 'https://example.test/api/assert-warmflag');
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
 * Drive the captured strategy through the REAL `TokenResolverBuilder`.
 *
 * <p>Issue #576's mis-diagnosis lives in the seam between that builder's
 * cold-retry ladder and the strategy's warm attempt, so a stub that re-ran the
 * ladder itself would assert this file's copy of the algorithm rather than the
 * shipped one and would stay green if the builder's ordering ever changed.
 * @param base - Stub bus whose apiPost dequeues scripted cold responses.
 * @param sink - Single-slot sink holding the captured registration.
 * @returns Header-value procedure from the real prime ladder.
 */
async function primeCaptured(base: IApiMediator, sink: ICaptured[]): Promise<Procedure<string>> {
  if (sink.length === 0) return fail(ScraperErrorTypes.Generic, 'no strategy registered');
  const { strategy, ctx, creds } = sink[0];
  const resolver = buildResolverFromStrategy({ strategy, bus: base, ctx, creds });
  return resolver.resolve();
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
 * @param config - Config the ACTION stage should run (defaults to warmConfig).
 * @returns The emitted log output plus the action's procedure result.
 */
async function runWithLogRecorder(
  rec: IWarmRecorder,
  token?: string,
  config: IApiDirectCallConfig = warmConfig(),
): Promise<{ logs: string; result: Procedure<unknown>; readLogs: () => string }> {
  const recorder = makeLogRecorder();
  const base = ctxFor(rec, token);
  const ctx = { ...base, logger: recorder.logger };
  const result = await runApiDirectCallAction(config, ctx);
  const logs = recorder.read();
  return { logs, result, readLogs: recorder.read };
}

/** The clause both fallback paths share — "this run paid for an SMS". */
const SMS_FALLBACK_CLAUSE = 'fell back to the full SMS login';

/**
 * Retired wording that asserted a bank refusal. The cold retry fires on any
 * warm failure, so this claim was never knowable; it must never come back.
 */
const RETIRED_REFUSAL_WORDING = 'stored long-term token was not accepted';

/** Cause named when a session that had been carrying fine died mid-run. */
const DEGRADED_CAUSE = 'warm session was rejected mid-run';

/** Cause named when the stored token never reached the bank at all. */
const STALE_CAUSE = 'stored long-term token failed the local freshness check';

/** Neutral cause named when a warm attempt was made and did not carry. */
const WARM_FAILED_CAUSE = 'warm start with the stored long-term token did not succeed';

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
  return logs.split(SMS_FALLBACK_CLAUSE).length - 1;
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
    expect(run.logs).not.toContain(SMS_FALLBACK_CLAUSE);
    await recoverColdly(rec);
    const after = run.readLogs();
    expect(after).toContain(SMS_FALLBACK_CLAUSE);
    expect(after).toContain(DEGRADED_CAUSE);
  });

  it('does not call a token that carried a session "not accepted"', async () => {
    const recovered = succeed({ access_token: RECOVERED_TOKEN });
    const rec = makeWarmRecordingBus([recovered]);
    const freshJwt = makeJwt(3600);
    const run = await runWithLogRecorder(rec, freshJwt);
    await recoverColdly(rec);
    const after = run.readLogs();
    expect(after).not.toContain(RETIRED_REFUSAL_WORDING);
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
    expect(logs).toContain(SMS_FALLBACK_CLAUSE);
  });

  /**
   * Drive one cold-retry run whose warm attempt fails for the given reason.
   * @param warmFailure - Scripted failure returned to the warm attempt.
   * @returns The emitted log output plus the action's procedure result.
   */
  async function runFailedWarmAttempt(
    warmFailure: Procedure<unknown>,
  ): Promise<{ logs: string; result: Procedure<unknown> }> {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const coldId = succeed({ access_token: 'cold-id' });
    const rec = makeWarmRecordingBus([warmFailure, coldTok, coldId]);
    const freshJwt = makeJwt(3600);
    const twoStep = warmTwoStepConfig();
    return runWithLogRecorder(rec, freshJwt, twoStep);
  }

  it('emits the neutral warm-failure clause instead of a refusal claim', async () => {
    const warmRefusal = fail(ScraperErrorTypes.Generic, 'bank refused the stored token');
    const { logs, result } = await runFailedWarmAttempt(warmRefusal);
    expect(result.success).toBe(true);
    expect(logs).toContain(WARM_FAILED_CAUSE);
  });

  it('does not call a timed-out warm attempt a bank refusal', async () => {
    const warmTimeout = fail(ScraperErrorTypes.Timeout, 'warm getIdToken timed out');
    const { logs } = await runFailedWarmAttempt(warmTimeout);
    expect(logs).not.toContain(RETIRED_REFUSAL_WORDING);
  });

  it("classifies the warm attempt's own failure instead of guessing", async () => {
    const warmTimeout = fail(ScraperErrorTypes.Timeout, 'warm getIdToken timed out');
    const { logs } = await runFailedWarmAttempt(warmTimeout);
    expect(logs).toContain(ScraperErrorTypes.Timeout);
  });

  it('does not attribute a transport failure to the stored token', async () => {
    const warmDown = fail(ScraperErrorTypes.NetworkError, 'connection reset by peer');
    const { logs } = await runFailedWarmAttempt(warmDown);
    expect(logs).toContain(ScraperErrorTypes.NetworkError);
  });

  it('never echoes the raw failure message, which banks fill with credentials', async () => {
    const leaky = fail(ScraperErrorTypes.Generic, 'rejected for user reuven pw hunter2');
    const { logs } = await runFailedWarmAttempt(leaky);
    expect(logs).not.toContain('hunter2');
  });

  it('redacts a password-class error type rather than naming it', async () => {
    const pwClass = fail(ScraperErrorTypes.InvalidPassword, 'bad password');
    const { logs } = await runFailedWarmAttempt(pwClass);
    expect(logs).not.toContain(ScraperErrorTypes.InvalidPassword);
  });

  it('does not blame the bank for a token the freshness gate rejected locally', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const staleJwt = makeJwt(-10);
    const { logs } = await runWithLogRecorder(rec, staleJwt);
    expect(logs).not.toContain(RETIRED_REFUSAL_WORDING);
  });

  it('names the local freshness gate when the token never reached the bank', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const staleJwt = makeJwt(-10);
    const { logs } = await runWithLogRecorder(rec, staleJwt);
    expect(logs).toContain(STALE_CAUSE);
  });

  it('sends no request when the freshness gate rejects the stored token', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const staleJwt = makeJwt(-10);
    await runWithLogRecorder(rec, staleJwt);
    const serialised = rec.captures.map(capture => JSON.stringify(capture));
    const warmSends = serialised.filter(text => text.includes(staleJwt));
    expect(warmSends).toHaveLength(0);
  });

  it('stays quiet when no token was stored, since nothing degraded', async () => {
    const coldTok = succeed({ access_token: 'cold-tok' });
    const rec = makeWarmRecordingBus([coldTok]);
    const { logs, result } = await runWithLogRecorder(rec);
    expect(result.success).toBe(true);
    expect(logs).not.toContain(SMS_FALLBACK_CLAUSE);
  });

  it('stays quiet when the warm path actually succeeded', async () => {
    const rec = makeWarmRecordingBus([]);
    const freshJwt = makeJwt(3600);
    const { logs, result } = await runWithLogRecorder(rec, freshJwt);
    expect(result.success).toBe(true);
    expect(logs).not.toContain(SMS_FALLBACK_CLAUSE);
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
