/**
 * Unit tests for the ApiDirectCall recovery hook (F3).
 *
 * Proves the hook built by {@link makeRecoveryHook} closes the self-heal gap:
 * after a successful cold recovery it (a) re-installs the NEW carry/session
 * context onto the bus and (b) re-surfaces the NEW long-term token to
 * `onAuthFlowComplete` so the working re-minted token is re-cached to disk
 * instead of being discarded (which would force a fresh OTP every run).
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

/**
 * Build a strategy stub returning the NEW carry snapshot + long-term token.
 * @returns Minimal config-strategy stub.
 */
function strategyStub(): IConfigTokenStrategy {
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
  return { getLatestCarrySnapshot, getLatestLongTermToken } as unknown as IConfigTokenStrategy;
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
 * Build a pipeline-context stub wired to a recording onAuthFlowComplete.
 * @param sink - Array receiving every re-cache payload.
 * @returns Minimal pipeline context.
 */
function ctxStub(sink: IAuthPayload[]): IPipelineContext {
  /**
   * Record the re-cache payload.
   * @param payload - Auth-flow payload forwarded by the hook.
   * @returns Resolved once recorded.
   */
  async function onAuthFlowComplete(payload: IAuthPayload): Promise<void> {
    sink.push(payload);
    await Promise.resolve();
  }
  return { options: { onAuthFlowComplete } } as unknown as IPipelineContext;
}

describe('makeRecoveryHook — re-install context + re-cache token (F3)', () => {
  it('installs the new carry snapshot and re-caches the new long-term token', async () => {
    const snapshots: SessionContext[] = [];
    const payloads: IAuthPayload[] = [];
    const bus = busStub(snapshots);
    const ctx = ctxStub(payloads);
    const strategy = strategyStub();
    const hook = makeRecoveryHook({ bus, ctx, strategy });
    await hook(RECOVERED_HEADER);
    expect(snapshots).toEqual([NEW_CARRY]);
    expect(payloads).toEqual([{ longTermToken: NEW_LONG_TERM, bearer: RECOVERED_HEADER }]);
  });
});
