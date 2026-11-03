/**
 * Unit tests for the ApiDirectCall recovery hook (F3).
 *
 * Proves the hook built by {@link makeRecoveryHook} closes the self-heal gap:
 * after a successful cold recovery it (a) re-installs the NEW carry/session
 * context onto the bus and (b) re-surfaces the NEW long-term token to
 * `onAuthFlowComplete` so the working re-minted token is re-cached to disk
 * instead of being discarded (which would force a fresh OTP every run).
 * It also tells the truth about the recovery: a resumed session is
 * noted once, and only a warm session that went cold is called degraded.
 */

import type {
  IApiMediator,
  SessionContext,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { makeRecoveryHook } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.recovery.js';
import type { IConfigTokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Auth-flow callback payload the re-cache path forwards. */
interface IAuthPayload {
  readonly longTermToken: string;
  readonly bearer: string;
}

const NEW_CARRY: SessionContext = Object.freeze({ token: 'new-carry-token' });
const NEW_LONG_TERM = 'new-long-term-jwt';
const RECOVERED_HEADER = 'Bearer recovered-bearer';

/** Log lines the hook wrote, by level. */
interface ILogSink {
  readonly warn: string[];
  readonly info: string[];
}

/** One logged entry, as the hook writes it. */
interface ILogEntry {
  readonly message: string;
}

/**
 * Build a strategy stub returning the NEW carry snapshot + long-term token.
 * @param lastRecoveryResumed - The recovery-outcome getter; omitted, the
 *   strategy predates it.
 * @returns Minimal config-strategy stub.
 */
function strategyStub(lastRecoveryResumed?: () => boolean): IConfigTokenStrategy {
  /**
   * Latest carry snapshot after recovery.
   * @returns The new carry snapshot.
   */
  function getLatestCarrySnapshot(): SessionContext {
    return NEW_CARRY;
  }
  /**
   * Latest long-term token after recovery.
   * @returns The new long-term token.
   */
  function getLatestLongTermToken(): string {
    return NEW_LONG_TERM;
  }
  /**
   * Whether the active session was primed from a cached warm token.
   * @returns Always false — this stub models a freshly recovered session.
   */
  function lastPrimeWasWarm(): boolean {
    return false;
  }
  const outcome = lastRecoveryResumed === undefined ? {} : { lastRecoveryResumed };
  return {
    getLatestCarrySnapshot,
    getLatestLongTermToken,
    lastPrimeWasWarm,
    ...outcome,
  } as unknown as IConfigTokenStrategy;
}

/**
 * Build a bus stub that records each session-context snapshot installed.
 * @param sink - Array receiving every installed snapshot.
 * @returns Minimal mediator stub.
 */
function busStub(sink: SessionContext[]): IApiMediator {
  /**
   * Record the installed session context.
   * @param ctx - Snapshot installed by the hook.
   * @returns true (ack contract).
   */
  function setSessionContext(ctx: SessionContext): boolean {
    sink.push(ctx);
    return true;
  }
  return { setSessionContext } as unknown as IApiMediator;
}

/**
 * Build a logger stub that records each message by level.
 * @param logs - Sink receiving every message.
 * @returns Minimal logger.
 */
function loggerStub(logs: ILogSink): IPipelineContext['logger'] {
  /**
   * Record a warning.
   * @param entry - Logged entry.
   * @returns Warnings recorded so far.
   */
  function warn(entry: ILogEntry): number {
    return logs.warn.push(entry.message);
  }
  /**
   * Record an info line.
   * @param entry - Logged entry.
   * @returns Info lines recorded so far.
   */
  function info(entry: ILogEntry): number {
    return logs.info.push(entry.message);
  }
  return { warn, info } as unknown as IPipelineContext['logger'];
}

/**
 * Build a pipeline-context stub wired to a recording onAuthFlowComplete.
 * @param sink - Array receiving every re-cache payload.
 * @param logs - Sink receiving every log line.
 * @returns Minimal pipeline context.
 */
function ctxStub(sink: IAuthPayload[], logs: ILogSink = { warn: [], info: [] }): IPipelineContext {
  /**
   * Record the re-cache payload.
   * @param payload - Auth-flow payload forwarded by the hook.
   * @returns Resolved once recorded.
   */
  async function onAuthFlowComplete(payload: IAuthPayload): Promise<void> {
    sink.push(payload);
    await Promise.resolve();
  }
  const logger = loggerStub(logs);
  return { options: { onAuthFlowComplete }, logger } as unknown as IPipelineContext;
}

describe('makeRecoveryHook — re-install context + re-cache token (F3)', () => {
  it('installs the new carry snapshot and re-caches the new long-term token', async () => {
    const snapshots: SessionContext[] = [];
    const payloads: IAuthPayload[] = [];
    const bus = busStub(snapshots);
    const ctx = ctxStub(payloads);
    const strategy = strategyStub();
    const hook = makeRecoveryHook({ bus, ctx, strategy, fallbackDetail: 'fell back' });
    const wasWarm = false;
    await hook(RECOVERED_HEADER, wasWarm);
    expect(snapshots).toEqual([NEW_CARRY]);
    expect(payloads).toEqual([{ longTermToken: NEW_LONG_TERM, bearer: RECOVERED_HEADER }]);
  });
});

/** One recovery the hook is told about. */
interface IRecoveryCase {
  readonly wasWarm: boolean;
  readonly lastRecoveryResumed?: () => boolean;
}

/**
 * Fire the hook once for a recovery and collect what it logged.
 * @param recovery - Session warmth and the strategy's recovery outcome.
 * @returns The log lines, by level.
 */
async function logsOf(recovery: IRecoveryCase): Promise<ILogSink> {
  const logs: ILogSink = { warn: [], info: [] };
  const ctx = ctxStub([], logs);
  const bus = busStub([]);
  const strategy = strategyStub(recovery.lastRecoveryResumed);
  const hook = makeRecoveryHook({ bus, ctx, strategy, fallbackDetail: 'fell back' });
  await hook(RECOVERED_HEADER, recovery.wasWarm);
  return logs;
}

/**
 * Outcome getter of a recovery that resumed the session.
 * @returns True.
 */
function resumedRecovery(): boolean {
  return true;
}

/**
 * Outcome getter of a recovery that logged in cold.
 * @returns False.
 */
function coldRecovery(): boolean {
  return false;
}

const DEGRADED = 'warm session was rejected mid-run';
const REGRANTED = 're-granted the session token';

describe('makeRecoveryHook — warning truth', () => {
  it('notes a resumed recovery once and does not call it degraded', async () => {
    const logs = await logsOf({ wasWarm: true, lastRecoveryResumed: resumedRecovery });
    expect(logs.info).toHaveLength(1);
    expect(logs.info[0]).toContain(REGRANTED);
    expect(logs.warn).toEqual([]);
  });

  it('warns when a warm session recovered cold', async () => {
    const logs = await logsOf({ wasWarm: true, lastRecoveryResumed: coldRecovery });
    expect(logs.warn).toHaveLength(1);
    expect(logs.warn[0]).toContain(DEGRADED);
    expect(logs.info).toEqual([]);
  });

  it.each<[string, boolean, number]>([
    ['warns for a warm session', true, 1],
    ['stays quiet for a cold session', false, 0],
  ])('without the outcome getter %s', async (_label, wasWarm, warnings) => {
    const logs = await logsOf({ wasWarm });
    expect(logs.warn).toHaveLength(warnings);
    expect(logs.info).toEqual([]);
  });
});
