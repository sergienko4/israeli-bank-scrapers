/**
 * Global pipeline state — active phase + stage.
 * Zero dependencies — safe to import from ANY module (no circular risk).
 * Set by BasePhase.run() via mediator. Read by any LOG call via getters.
 */

import type { Brand } from './Brand.js';

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
  return activePhase as ActivePhaseName;
}

/**
 * Set the currently active pipeline phase.
 * @param name - Phase name.
 * @returns True after setting.
 */
function setActivePhase(name: string): true {
  activePhase = name;
  return true;
}

/**
 * Get the currently active pipeline stage name.
 * @returns Stage name (PRE, ACTION, POST, FINAL).
 */
function getActiveStage(): StageLabel {
  return activeStage;
}

/**
 * Set the currently active pipeline stage.
 * @param name - Stage name (PRE, ACTION, POST, FINAL).
 * @returns True after setting.
 */
function setActiveStage(name: StageLabel): true {
  activeStage = name;
  return true;
}

export type { StageLabel };
export { getActivePhase, getActiveStage, setActivePhase, setActiveStage };
