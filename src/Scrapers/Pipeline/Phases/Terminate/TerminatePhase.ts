/**
 * TERMINATE phase — thin orchestration, all logic in Mediator/Terminate.
 * PRE:    guard (no browser → passthrough)
 * ACTION: run LIFO cleanups — never fails
 * POST:   stamp diagnostics
 * FINAL:  done
 */

import {
  executeLogResults,
  executeRunCleanups,
  executeRunCleanupsFromContext,
  executeSignalDone,
  executeStartCleanup,
  runAllCleanups,
} from '../../Mediator/Terminate/TerminateActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/**
 * Build sealed action context from full pipeline context for terminate.
 * Spread preserves browser so executeRunCleanups can probe it at runtime.
 * @param input - Full pipeline context.
 * @returns Action context with browser accessible at runtime.
 */
function buildTerminateActionCtx(input: IPipelineContext): IActionContext {
  const noExecutor = { has: false } as IActionContext['executor'];
  return { ...input, executor: noExecutor };
}

/**
 * Compat step — use createTerminatePhase() for new code.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Cleanup result.
 */
async function terminateStepExec(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const actionCtx = buildTerminateActionCtx(input);
  const result = await executeRunCleanups(actionCtx);
  if (!result.success) return result;
  return succeed(input);
}

/** Compat step — tests use .execute(). Prefer createTerminatePhase(). */
const TERMINATE_STEP = {
  name: 'terminate' as const,
  execute: terminateStepExec,
};

/** TERMINATE phase — BasePhase with PRE/ACTION/POST/FINAL. */
class TerminatePhase extends BasePhase {
  public readonly name = 'terminate' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeStartCleanup(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const cleanupResult = await executeRunCleanupsFromContext(input);
    if (!cleanupResult.success) return cleanupResult;
    return executeLogResults(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeSignalDone(input);
  }
}

/**
 * Create the TERMINATE phase instance.
 * @returns TerminatePhase.
 */
function createTerminatePhase(): TerminatePhase {
  return new TerminatePhase();
}

export { createTerminatePhase, runAllCleanups, TERMINATE_STEP, TerminatePhase };
