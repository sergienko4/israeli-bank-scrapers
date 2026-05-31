/**
 * WafChallenge — type contracts for the generic WAF challenge interceptor.
 *
 * Discriminated by `kind` so the solver registry can be a pure map lookup
 * (Open/Closed). Adding a new provider (Arkose, GeeTest) means registering
 * a new kind + solver pair — zero edits to the detection or attachment flow.
 */

import type { Frame, Page } from 'playwright-core';

import type { Brand } from '../../Types/Brand.js';

/**
 * Provider + interaction primitive identifier.
 *
 * <p>Simple checkbox auto-pass is the only documented Camoufox primitive
 * (`disable_coop + humanize + mouse.click`). Image / audio challenges are
 * out of scope — they require a third-party solver service.
 */
type WafChallengeKind = 'hcaptcha-checkbox' | 'turnstile-checkbox';

/** Detected challenge — provider + reference to the iframe containing it. */
interface IWafChallenge {
  readonly kind: WafChallengeKind;
  readonly frame: Frame;
}

/** Solver outcome — branded boolean keeps Procedure-style call sites strict. */
type DidSolve = Brand<boolean, 'DidSolve'>;

/** Inputs handed to every solver — page is needed for `mouse.click`. */
interface ISolverArgs {
  readonly page: Page;
  readonly frame: Frame;
}

/** Solver function signature — all solvers are async and return DidSolve. */
type WafChallengeSolver = (args: ISolverArgs) => Promise<DidSolve>;

export type { DidSolve, ISolverArgs, IWafChallenge, WafChallengeKind, WafChallengeSolver };
