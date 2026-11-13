/**
 * Active pipeline phase + stage.
 * Depends only on the run scope — safe to import from ANY module (no circular risk).
 * Set by BasePhase.run() via mediator. Read by any LOG call via getters.
 *
 * Inside an `executePipeline` run the labels live in that run's scope, so
 * overlapping executions each report their own. Outside a run — log lines
 * emitted before one starts, or a phase driven directly by a unit test — they
 * fall back to the process-global variables below.
 */

import type { Brand } from './Brand.js';
import { currentRunScope } from './RunScope.js';

/** Active phase name — branded for Rule #15. */
type ActivePhaseName = Brand<string, 'ActivePhaseName'>;

/** Stage label — exactly one of the 4-stage protocol values. */
type StageLabel = 'PRE' | 'ACTION' | 'POST' | 'FINAL';

/** Currently active pipeline phase. */
let activePhase = 'init';
/** Currently active pipeline stage. */
let activeStage: StageLabel = 'PRE';

/**
 * Get the currently active pipeline phase name.
 * @returns Phase name string.
 */
function getActivePhase(): ActivePhaseName {
  const scope = currentRunScope();
  if (scope) return scope.phase as ActivePhaseName;
  return activePhase as ActivePhaseName;
}

/**
 * Set the currently active pipeline phase.
 * @param name - Phase name.
 * @returns True after setting.
 */
function setActivePhase(name: string): true {
  const scope = currentRunScope();
  if (scope) scope.phase = name;
  else activePhase = name;
  return true;
}

/**
 * Get the currently active pipeline stage name.
 * @returns Stage name (PRE, ACTION, POST, FINAL).
 */
function getActiveStage(): StageLabel {
  const scope = currentRunScope();
  if (scope) return scope.stage as StageLabel;
  return activeStage;
}

/**
 * Set the currently active pipeline stage.
 * @param name - Stage name (PRE, ACTION, POST, FINAL).
 * @returns True after setting.
 */
function setActiveStage(name: StageLabel): true {
  const scope = currentRunScope();
  if (scope) scope.stage = name;
  else activeStage = name;
  return true;
}

export type { StageLabel };
export { getActivePhase, getActiveStage, setActivePhase, setActiveStage };
