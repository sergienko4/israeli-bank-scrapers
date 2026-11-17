/**
 * Per-execution log context injection.
 *
 * Merges the ambient `bank` / `phase` / `stage` / `runId` context into every
 * line pino emits. All four come from the run scope that
 * {@link runWithBankContext} opens for one `executePipeline` call, so two
 * overlapping executions each stamp their own lines. Outside a scope the
 * phase, stage and runId fall back to the process-global state their owners
 * keep for that purpose, and `bank` is absent.
 */

import { getActivePhase, getActiveStage } from '../Types/ActiveState.js';
import { ENVIRONMENT, type IEnvironment } from '../Types/Environment.js';
import { currentRunScope, openRunScope } from '../Types/RunScope.js';
import { getActiveRunId } from '../Types/TraceConfig.js';

/**
 * The `bank` field of the running execution's scope.
 * @returns `{ bank }` inside a scope, an empty record outside every one.
 */
function bankField(): Record<string, string> {
  const scope = currentRunScope();
  return scope ? { bank: scope.bank } : {};
}

/**
 * Pino mixin: injects ambient context onto every log line so callers
 * never have to attach `bank` / `phase` / `stage` / `runId` manually.
 *
 * Fields:
 *   - `bank` — the bank of the scope established by {@link runWithBankContext}
 *     in `PipelineExecutor`; absent outside one.
 *   - `phase` — the scope's current pipeline phase.
 *   - `stage` — the scope's 4-stage protocol position (PRE / ACTION / POST / FINAL).
 *   - `runId` — the scope's own run stamp (`DD-MM-YYYY_HHMMSScc`), allocated once
 *     per execution; SAME value the trace artefact folder is named with on disk,
 *     so a log line can be deterministically joined to its `network/` siblings
 *     even after logs are aggregated off-host. Omitted from the mixin object when
 *     empty (log lines before any bank is known) so it never appears as `runId:""`.
 *
 * @returns Mixin fields to merge onto every log entry.
 */
export function getBankMixin(): Record<string, string> {
  const runId = getActiveRunId();
  const fields: Record<string, string> = { ...bankField() };
  fields.phase = getActivePhase();
  fields.stage = getActiveStage();
  if (runId.length > 0) fields.runId = runId;
  return fields;
}

/** Environment snapshot plus optional run cancellation for a scope. */
interface IRunScopeSetup {
  readonly env?: IEnvironment;
  readonly signal?: AbortSignal | false;
}

/** A runWithBankContext third argument: an environment or a setup bundle. */
type TRunScopeSetup = IEnvironment | IRunScopeSetup;

/**
 * Whether the third argument carries the complete environment shape.
 * @param setup - Environment snapshot or setup bundle.
 * @returns True for an environment snapshot.
 */
function isEnvironment(setup: TRunScopeSetup): setup is IEnvironment {
  return 'forensicTrace' in setup && 'runsRoot' in setup;
}

/**
 * Whether the third argument is a setup bundle rather than an environment.
 * @param setup - Environment snapshot or setup bundle.
 * @returns True for the setup bundle.
 */
function isScopeSetup(setup: TRunScopeSetup): setup is IRunScopeSetup {
  return !isEnvironment(setup);
}

/**
 * Resolve the environment and signal a caller supplied.
 * @param setup - Environment snapshot or setup bundle.
 * @returns The environment and signal to open the scope with.
 */
function resolveSetup(setup: TRunScopeSetup): Required<IRunScopeSetup> {
  if (isScopeSetup(setup)) return { env: setup.env ?? ENVIRONMENT, signal: setup.signal ?? false };
  return { env: setup, signal: false };
}

/**
 * Run a function inside a fresh run scope: its own bank, phase, stage and run
 * identity, injected into every pino log line the function emits.
 * @param bank - The bank identifier (companyId).
 * @param fn - The function to execute within the scope.
 * @param setup - Environment snapshot or setup bundle with the run signal.
 * @returns The result of the function.
 */
export function runWithBankContext<T>(
  bank: string,
  fn: () => T,
  setup: TRunScopeSetup = ENVIRONMENT,
): T {
  const resolved = resolveSetup(setup);
  return openRunScope({ bank, env: resolved.env, signal: resolved.signal }, fn);
}
