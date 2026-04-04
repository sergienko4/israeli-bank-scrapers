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
  executeSignalDone,
  executeStartCleanup,
  runAllCleanups,
} from '../../Mediator/Terminate/TerminateActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/**
 * Compat step — use createTerminatePhase() for new code.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Cleanup result.
 */
function terminateStepExec(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  return executeRunCleanups(input);
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
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeRunCleanups(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
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
