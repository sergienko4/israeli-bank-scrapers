/**
 * WafChallengeSolverRegistry — maps WafChallengeKind to its solver.
 *
 * SOLID/OCP: adding a new provider means appending one entry — zero edits
 * to the interceptor or detector files. The map is built as a frozen
 * `Record<WafChallengeKind, WafChallengeSolver>` so TypeScript's
 * exhaustiveness check enforces "every kind has a solver" at compile time.
 */

import { solveHCaptchaCheckbox } from './HCaptchaCheckboxSolver.js';
import { solveTurnstileCheckbox } from './TurnstileCheckboxSolver.js';
import type { WafChallengeKind, WafChallengeSolver } from './WafChallengeTypes.js';

/**
 * Provider-kind -> solver-function registry. Frozen so a misbehaving
 * caller cannot mutate the global mapping at runtime.
 */
const SOLVER_REGISTRY: Readonly<Record<WafChallengeKind, WafChallengeSolver>> = Object.freeze({
  'hcaptcha-checkbox': solveHCaptchaCheckbox,
  'turnstile-checkbox': solveTurnstileCheckbox,
});

/**
 * Resolve a solver for a given kind.
 *
 * <p>The exhaustive `Record<WafChallengeKind, …>` typing guarantees the
 * lookup always succeeds — callers receive a concrete function, never
 * undefined.
 *
 * @param kind - Provider/interaction kind from detection.
 * @returns The matching solver function.
 */
function getSolver(kind: WafChallengeKind): WafChallengeSolver {
  return SOLVER_REGISTRY[kind];
}

export { getSolver, SOLVER_REGISTRY };
