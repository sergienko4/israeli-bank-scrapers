/**
 * Unit tests for WafChallengeSolverRegistry — exhaustive provider→solver map.
 *
 * <p>The registry is frozen + typed as Record<WafChallengeKind,...> so the
 * compiler enforces exhaustiveness; these tests guard against accidental
 * unfreeze + runtime swaps.
 */

import { solveHCaptchaCheckbox } from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/HCaptchaCheckboxSolver.js';
import { solveTurnstileCheckbox } from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/TurnstileCheckboxSolver.js';
import {
  getSolver,
  SOLVER_REGISTRY,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeSolverRegistry.js';

describe('WafChallengeSolverRegistry.SOLVER_REGISTRY', () => {
  it('is frozen', () => {
    const isFrozenMap = Object.isFrozen(SOLVER_REGISTRY);
    expect(isFrozenMap).toBe(true);
  });

  it('has exactly the two registered kinds', () => {
    const keys = Object.keys(SOLVER_REGISTRY).sort();
    expect(keys).toEqual(['hcaptcha-checkbox', 'turnstile-checkbox']);
  });

  it('routes hcaptcha-checkbox to solveHCaptchaCheckbox', () => {
    const solver = SOLVER_REGISTRY['hcaptcha-checkbox'];
    expect(solver).toBe(solveHCaptchaCheckbox);
  });

  it('routes turnstile-checkbox to solveTurnstileCheckbox', () => {
    const solver = SOLVER_REGISTRY['turnstile-checkbox'];
    expect(solver).toBe(solveTurnstileCheckbox);
  });
});

describe('WafChallengeSolverRegistry.getSolver', () => {
  it('returns the hCaptcha solver for hcaptcha-checkbox', () => {
    const solver = getSolver('hcaptcha-checkbox');
    expect(solver).toBe(solveHCaptchaCheckbox);
  });

  it('returns the Turnstile solver for turnstile-checkbox', () => {
    const solver = getSolver('turnstile-checkbox');
    expect(solver).toBe(solveTurnstileCheckbox);
  });
});
