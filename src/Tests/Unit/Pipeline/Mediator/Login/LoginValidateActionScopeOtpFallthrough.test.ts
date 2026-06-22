/**
 * Mission M4.F2.b — LOGIN.POST OTP discriminator.
 *
 * <p>Pins {@link validateActionScopeIntact}'s ambiguous-branch
 * behaviour: when the URL is unchanged AND the password element is still
 * in the DOM, the validator returns `false` (fall through to OTP-TRIGGER)
 * ONLY when a genuine one-time-code input is rendered. A page that shows
 * merely the always-coresident SMS-lobby / password-submit buttons (NO
 * code input) is an honest credential failure → `INVALID_PASSWORD`.
 *
 * <p>PR #282 (commit 97ca1353) regression guard: the previous probe
 * accepted a structural OTP-TRIGGER button (`//button[@type="submit"]`,
 * `//form//button`) as proof of an OTP screen, so a failed login that
 * stayed on the login URL was masked as an OTP fall-through — killing the
 * retry-recovery and surfacing as `failEmpty`. The discriminator now
 * requires a real OTP CODE INPUT ({@link otpScreenVisible} →
 * `detectOtpForm` only), so trigger-only pages fail honestly.
 *
 * <p>Test Case IDs:
 *   - LOGIN-POST-OTP-001: OTP code input visible → fall through (no fail)
 *   - LOGIN-POST-OTP-002: NO code input (only lobby/trigger buttons) →
 *     INVALID_PASSWORD (the #282 regression guard)
 *   - LOGIN-POST-OTP-003: URL changed → fall through immediately (no probe)
 *   - LOGIN-POST-OTP-004: password absent → fall through immediately (no probe)
 *   - LOGIN-POST-OTP-005 (PR #221 review id 3216542548): OTP probe REJECTS
 *     → fall through (probe-failure is unknown, not INVALID_PASSWORD)
 */

import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { validateActionScopeIntact } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  ILoginFieldDiscovery,
  IPipelineContext,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { LOGIN_FIELDS } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/**
 * Scripted answer for a single `resolveVisible` call. PR #221 review
 * (id 3216542553) — replaces the prior `'placeholder'`/`'clickableText'`
 * kind-routing that encoded WK probe internals into the test. Each
 * scenario row lists the answers IN CALL ORDER instead.
 *
 * <p>Since the PR #282 regression fix, `otpScreenVisible` runs ONLY
 * `detectOtpForm` (the genuine OTP-code-input probe) — the structural
 * OTP-trigger probe was dropped because it false-matched the always-
 * coresident SMS-lobby / password-submit buttons. So `resolveVisible`
 * is invoked exactly ONCE per validator entry in the URL-unchanged +
 * password-present branch (the single form probe). Each step in
 * {@link IMediatorConfig.probeAnswers} is consumed in order regardless
 * of how the underlying probe names its kinds.
 */
type ProbeAnswer = 'found' | 'not-found' | 'reject';

/**
 * Stub IRaceResult: a found / not-found pair so the stub mediator
 * can report "OTP visible" via a successful race.
 *
 * @param wasFound - Whether the candidate was resolved.
 * @returns Race-result-like shape with the {found} flag set.
 */
function raceResult(wasFound: boolean): IRaceResult {
  return { found: wasFound } as unknown as IRaceResult;
}

/**
 * Resolve a single scripted answer into the value the stubbed
 * `resolveVisible` should yield — `Promise.resolve(...)` for the two
 * boolean-valued outcomes, `Promise.reject(...)` for the probe-failure
 * variant. Extracted so {@link makeMediator}'s closure stays inside
 * the project's 10-line ceiling.
 *
 * @param answer - Scripted probe outcome.
 * @returns Promise the stub returns from `resolveVisible`.
 */
function answerToRace(answer: ProbeAnswer): Promise<IRaceResult> {
  if (answer === 'reject') {
    const stubError = new TypeError('probe failed (test stub)');
    return Promise.reject(stubError);
  }
  const wasFound = answer === 'found';
  const race = raceResult(wasFound);
  return Promise.resolve(race);
}

/** Configuration for the stub mediator's per-call answers. */
interface IMediatorConfig {
  readonly currentUrl: string;
  readonly passwordCount: number;
  /** Per-call answers consumed in invocation order. */
  readonly probeAnswers: readonly ProbeAnswer[];
}

/**
 * Build a minimal IElementMediator stub. PR #221 review (id 3216542553)
 * — drives `resolveVisible` via per-call factories instead of routing by
 * candidate `.kind` literals, so the suite no longer fails on harmless
 * refactors inside `detectOtpTrigger` / `detectOtpForm`.
 *
 * @param config - Scripted answers for this scenario.
 * @returns IElementMediator stub.
 */
function makeMediator(config: IMediatorConfig): IElementMediator {
  let callIndex = 0;
  return {
    /**
     * Returns the scripted current URL.
     * @returns Scripted URL string.
     */
    getCurrentUrl: (): string => config.currentUrl,
    /**
     * Returns the scripted password-selector count.
     * @returns Scripted count.
     */
    countBySelector: async (): Promise<number> => {
      await Promise.resolve();
      return config.passwordCount;
    },
    /**
     * Yields the next scripted probe answer in call order. Falls back
     * to `not-found` once the script is exhausted so a misconfigured
     * scenario fails as "no OTP" rather than hanging.
     * @returns Race result per the scripted answer.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      const answer = config.probeAnswers[callIndex] ?? 'not-found';
      callIndex += 1;
      return answerToRace(answer);
    },
    /**
     * No-op bounded network settle. The PR #385 scope-intact in-flight
     * re-probe awaits this before failing; resolve immediately so these
     * STATIC #282 scenarios keep their pre-settle verdict (no transition
     * → still InvalidPassword). Returns a constant to satisfy the
     * architecture no-return-void rule.
     * @returns Resolved sentinel (settle complete).
     */
    waitForNetworkIdle: (): Promise<false> => Promise.resolve(false),
  } as unknown as IElementMediator;
}

/**
 * Build a minimal IPipelineContext stub with the fields
 * {@link validateActionScopeIntact} reads.
 *
 * @param loginUrl - The login URL stored in diagnostics.
 * @param passwordSelector - Selector string used by the validator.
 * @returns Pipeline-context-shaped stub.
 */
function makeContext(loginUrl: string, passwordSelector: string): IPipelineContext {
  const passwordTarget: IResolvedTarget = {
    selector: passwordSelector,
    contextId: 'frame-0',
    kind: 'css',
    candidateValue: 'password',
  };
  const discovery: ILoginFieldDiscovery = {
    targets: new Map([[LOGIN_FIELDS.PASSWORD, passwordTarget]]),
    formAnchor: none(),
    activeFrameId: 'frame-0',
    submitTarget: none(),
  };
  return {
    diagnostics: { loginUrl },
    loginFieldDiscovery: some(discovery),
    // Empty config = a bank that did NOT opt into a custom scope-intact
    // settle budget, so readSettleBudget falls back to the default (~4 s,
    // ≤2 poll probes) — the unchanged pre-PR-385 verdict window these
    // STATIC #282 scenarios assert against.
    config: {},
    logger: {
      /**
       * No-op debug sink — discards diagnostics produced by the
       * validator so the test asserts only on the return value.
       * Returns a non-undefined value to satisfy the architecture
       * `no-return-void` rule; the validator never reads it.
       * @returns Constant false sentinel.
       */
      debug: (): false => false,
      /**
       * No-op trace sink — same intent as the debug sink.
       * @returns Constant false sentinel.
       */
      trace: (): false => false,
    },
  } as unknown as IPipelineContext;
}

describe('LOGIN.POST validateActionScopeIntact — M4.F2.b OTP discriminator', () => {
  const loginUrl = 'https://login.bank.fake.example/ng-portals/auth/he/';
  const passwordSelector = '#password';

  it('LOGIN-POST-OTP-001: OTP code input visible → fall through (no fail)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-002: no code input (lobby buttons only) → INVALID_PASSWORD', async () => {
    // PR #282 (commit 97ca1353) REGRESSION GUARD. The page stays on the
    // login URL with the password still present and shows only the
    // always-coresident SMS-lobby / password-submit buttons — NO genuine
    // one-time-code input. The old probe accepted those structural
    // trigger buttons as an "OTP screen" and masked the failure as a
    // fall-through (→ failEmpty). The discriminator now requires a real
    // code input, so this is an honest credential failure.
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['not-found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.success).toBe(false);
    }
  });

  it('LOGIN-POST-OTP-003: URL changed → fall through immediately (no probe)', async () => {
    const mediator = makeMediator({
      currentUrl: 'https://login.bank.fake.example/dashboard/',
      passwordCount: 1,
      probeAnswers: [],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-004: password element absent → fall through (no probe)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 0,
      probeAnswers: [],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-005: probe REJECTS → fall through (probe-failure is unknown ≠ invalid)', async () => {
    // PR #221 review (id 3216542548): a transient resolver failure on
    // the OTP-form probe used to collapse into "not visible" → false-
    // positive INVALID_PASSWORD. The fix returns `'unknown'` from
    // `otpScreenVisible`; the validator falls through instead of firing
    // the credential-failure gate.
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['reject'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });
});
