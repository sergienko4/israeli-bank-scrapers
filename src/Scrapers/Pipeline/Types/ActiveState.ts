/**
 * Global pipeline state — active phase + stage.
 * Zero dependencies — safe to import from ANY module (no circular risk).
 * Set by BasePhase.run() via mediator. Read by any LOG call via getters.
 */

/** Phase label for logging. */
type PhaseLabel = string;
/** Stage label — exactly one of the 4-stage protocol values. */
type StageLabel = 'PRE' | 'ACTION' | 'POST' | 'FINAL';

/** Currently active pipeline phase. */
let activePhase: PhaseLabel = 'init';
/** Currently active pipeline stage. */
let activeStage: StageLabel = 'PRE';

/**
 * Get the currently active pipeline phase name.
 * @returns Phase name string.
 */
function getActivePhase(): PhaseLabel {
  return activePhase;
}

/**
 * Set the currently active pipeline phase.
 * @param name - Phase name.
 * @returns True after setting.
 */
function setActivePhase(name: PhaseLabel): true {
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
