/**
 * Mission M4.F2.b — LOGIN.POST OTP discriminator.
 *
 * <p>Pins {@link validateActionScopeIntact}'s ambiguous-branch
 * behaviour: when URL is unchanged AND the password element is still
 * resolvable AND an OTP-trigger or OTP-input element is visible, the
 * validator returns `false` (fall through to OTP-TRIGGER) instead of
 * firing a false-positive `INVALID_PASSWORD`.
 *
 * <p>Test Case IDs:
 *   - LOGIN-POST-OTP-001: OTP form visible → fall through (no fail)
 *   - LOGIN-POST-OTP-002: OTP trigger visible → fall through (no fail)
 *   - LOGIN-POST-OTP-003: neither visible → INVALID_PASSWORD (regression guard)
 *   - LOGIN-POST-OTP-004: URL changed → fall through immediately (no probe)
 *   - LOGIN-POST-OTP-005: password absent → fall through immediately (no probe)
 *   - LOGIN-POST-OTP-006 (PR #221 review id 3216542548): OTP probe REJECTS
 *     → fall through (probe-failure is unknown, not INVALID_PASSWORD)
 *   - LOGIN-POST-OTP-007: BOTH probes reject → fall through (unknown)
 *   - LOGIN-POST-OTP-008: browser navigates while the OTP probe runs
 *     → fall through (the URL sample is stale by the time it is used)
 *   - LOGIN-POST-OTP-009: form leaves the screen while the OTP probe runs
 *     → fall through (same staleness, for banks that do not navigate)
 *   - LOGIN-POST-OTP-011: URL evidence outranks visibility evidence
 *   - LOGIN-POST-OTP-012: scope still holds at the verdict → INVALID_PASSWORD
 *     (mutation guard for 008 + 009)
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { validateActionScopeIntact } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import {
  SCOPE_LEFT_LOGIN_URL_LOG,
  SCOPE_TORN_DOWN_FALLTHROUGH_LOG,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/ScopeIntact/ScopeIntactTypes.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  ILoginFieldDiscovery,
  IPipelineContext,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { LOGIN_FIELDS } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Scripted answer for a single `resolveVisible` call. PR #221 review
 * (id 3216542553) — replaces the prior `'placeholder'`/`'clickableText'`
 * kind-routing that encoded WK probe internals into the test. Each
 * scenario row lists the answers IN CALL ORDER instead.
 *
 * <p>`otpScreenVisible` runs `Promise.all([detectOtpTrigger, detectOtpForm])`
 * — both calls are dispatched synchronously, so `resolveVisible` is
 * invoked exactly TWICE per validator entry in the URL-unchanged +
 * password-present branch. Call #1 ≡ trigger probe, call #2 ≡ form
 * probe. Each step in {@link IMediatorConfig.probeAnswers} is consumed
 * in order regardless of how the underlying probes name their kinds.
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
  /**
   * Per-call on-screen answers consumed in invocation order. Omit to mirror
   * {@link IMediatorConfig.passwordCount} on every call (the steady-state
   * page). Supply a script to model a page that changes mid-verdict.
   */
  readonly visibilityAnswers?: readonly boolean[];
  /**
   * Per-call URL answers consumed in invocation order. Omit to return
   * {@link IMediatorConfig.currentUrl} on every call. Supply a script to
   * model a browser that navigates while the OTP probe is running.
   */
  readonly urlAnswers?: readonly string[];
}

/**
 * Invocation counters exposed by the stub so a scenario can assert *which*
 * production reads it exercised, not merely the verdict. Without this a test
 * that scripts answers positionally stays green when an unrelated change
 * inserts an extra read and shifts the script under it.
 */
interface ICallCounts {
  url: number;
  visibility: number;
  probe: number;
}

/**
 * Read the invocation counters off a stub built by {@link makeMediator}.
 * @param mediator - Stub mediator.
 * @returns Live counters for this stub.
 */
function callCountsOf(mediator: IElementMediator): ICallCounts {
  return (mediator as unknown as { readonly callCounts: ICallCounts }).callCounts;
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
  const counts: ICallCounts = { url: 0, visibility: 0, probe: 0 };
  return {
    callCounts: counts,
    /**
     * Yields the next scripted URL, falling back to the steady-state one.
     * @returns Scripted URL string.
     */
    getCurrentUrl: (): string => {
      const scriptedUrl = config.urlAnswers?.[counts.url];
      counts.url += 1;
      return scriptedUrl ?? config.currentUrl;
    },
    /**
     * Returns the scripted password-selector count.
     * @returns Scripted count.
     */
    countBySelector: async (): Promise<number> => {
      await Promise.resolve();
      return config.passwordCount;
    },
    /**
     * Yields the next scripted on-screen answer, falling back to mirroring
     * the scripted count — a password element that persists is one the user
     * can still see unless the scenario says otherwise.
     * @returns True when the form is on screen for this call.
     */
    isVisibleBySelector: async (): Promise<boolean> => {
      await Promise.resolve();
      const isScripted = config.visibilityAnswers?.[counts.visibility];
      counts.visibility += 1;
      const isPresent = config.passwordCount > 0;
      return isScripted ?? isPresent;
    },
    /**
     * Yields the next scripted probe answer in call order. Falls back
     * to `not-found` once the script is exhausted so a misconfigured
     * scenario fails as "no OTP" rather than hanging.
     * @returns Race result per the scripted answer.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      const answer = config.probeAnswers[counts.probe] ?? 'not-found';
      counts.probe += 1;
      return answerToRace(answer);
    },
  } as unknown as IElementMediator;
}

/**
 * Build a minimal IPipelineContext stub with the fields
 * {@link validateActionScopeIntact} reads.
 *
 * <p>The debug sink records every message so a scenario can assert *which*
 * diagnostic route the validator took. Two fall-through routes both return
 * `false`, so a verdict-only assertion cannot tell them apart — swapping the
 * URL and visibility checks would leave the return value unchanged.
 *
 * @param loginUrl - The login URL stored in diagnostics.
 * @param passwordSelector - Selector string used by the validator.
 * @param logSink - Array the debug sink appends every message to.
 * @returns Pipeline-context-shaped stub.
 */
function makeContext(
  loginUrl: string,
  passwordSelector: string,
  logSink: string[] = [],
): IPipelineContext {
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
    logger: {
      /**
       * Recording debug sink — appends each message to `logSink` so a
       * scenario can pin which diagnostic route ran.
       * Returns a non-undefined value to satisfy the architecture
       * `no-return-void` rule; the validator never reads it.
       * @param entry - Structured log entry emitted by the validator.
       * @param entry.message - Diagnostic text to record.
       * @returns Constant false sentinel.
       */
      debug: (entry: { readonly message: string }): false => {
        logSink.push(entry.message);
        return false;
      },
      /**
       * No-op trace sink — same intent as the debug sink.
       * @returns Constant false sentinel.
       */
      trace: (): false => false,
    },
  } as unknown as IPipelineContext;
}

/**
 * Assert a verdict is the INVALID_PASSWORD failure, not merely "not false".
 *
 * <p>`expect(result).not.toBe(false)` accepts any {@link Procedure} — a
 * success included — so it cannot tell a correct rejection from a validator
 * that returned the wrong verdict entirely.
 * @param result - Verdict under test.
 * @returns Constant false sentinel (architecture `no-return-void` rule).
 */
function expectInvalidPassword(result: Procedure<IPipelineContext> | false): false {
  expect(result).not.toBe(false);
  if (result === false) return false;
  expect(result.success).toBe(false);
  if (result.success) return false;
  expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  return false;
}

describe('LOGIN.POST validateActionScopeIntact — M4.F2.b OTP discriminator', () => {
  const loginUrl = 'https://login.bank.fake.example/ng-portals/auth/he/';
  const passwordSelector = '#password';

  it('LOGIN-POST-OTP-001: OTP form visible → fall through (no fail)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['not-found', 'found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-002: OTP trigger visible → fall through (no fail)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['found', 'not-found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-003: neither OTP element visible → INVALID_PASSWORD', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['not-found', 'not-found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.success).toBe(false);
    }
  });

  it('LOGIN-POST-OTP-004: URL changed → fall through immediately (no probe)', async () => {
    const mediator = makeMediator({
      currentUrl: 'https://login.bank.fake.example/dashboard/',
      passwordCount: 1,
      probeAnswers: ['not-found', 'not-found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-005: password element absent → fall through (no probe)', async () => {
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 0,
      probeAnswers: ['not-found', 'not-found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-006: probe REJECTS → fall through (probe-failure is unknown ≠ invalid)', async () => {
    // PR #221 review (id 3216542548): a transient resolver failure on
    // either probe used to collapse into "not visible" → false-positive
    // INVALID_PASSWORD. The fix returns `'unknown'` from
    // `otpScreenVisible`; the validator falls through instead of
    // firing the credential-failure gate.
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['reject', 'not-found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('LOGIN-POST-OTP-007: BOTH probes REJECT → fall through (unknown, not invalid)', async () => {
    // Companion case to 006: both probes fail. Symmetric outcome —
    // unknown means unknown; the validator must not pick a verdict.
    const mediator = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['reject', 'reject'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  // Discount, CI run 33016514628 — the failure this suite exists to prevent.
  // The login SUCCEEDED (`Login.Status=SUCCESS` in the captured body) and the
  // bank answered with a 301 to its authenticated app at submit+0.36s. But
  // the URL is sampled at submit+0.19s, 170ms too early, and the verdict is
  // only reached at submit+3.2s once both OTP races time out. By then the
  // browser had been off the login URL for 2.66s, yet the verdict read the
  // stale sample and condemned a session that had authenticated. That 170ms
  // window is why Discount failed 6 of 14 CI runs, flipping red↔green on
  // consecutive commits of the SAME branch.
  // Discount, CI run 33016514628 attempt 2 — the failure this suite exists to
  // prevent. The login SUCCEEDED (`Login.Status=SUCCESS` in the captured body)
  // and the bank answered with a 301 to its authenticated app at submit+0.36s.
  // But the URL is sampled at submit+0.19s, 170ms too early, and the verdict is
  // only reached at submit+3.2s once both OTP races time out. By then the
  // browser had been off the login URL for 2.66s, yet the verdict read the
  // stale sample and condemned a session that had authenticated.
  //
  // This 170ms ordering explains that captured attempt and is consistent with
  // the observed intermittent LOGIN failures; the remaining red runs were NOT
  // traced to this mechanism (one failed at HOME PRE, a different stage).
  const noOtpScenario: IMediatorConfig = {
    currentUrl: loginUrl,
    passwordCount: 1,
    probeAnswers: ['not-found', 'not-found'],
  };
  const authenticatedUrl = 'https://login.bank.fake.example/apollo/retail3/';

  it('LOGIN-POST-OTP-008: browser navigates during the OTP probe → fall through', async () => {
    const mediator = makeMediator({ ...noOtpScenario, urlAnswers: [loginUrl, authenticatedUrl] });
    const logs: string[] = [];
    const ctx = makeContext(loginUrl, passwordSelector, logs);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
    const counts = callCountsOf(mediator);
    expect(counts).toMatchObject({ url: 2, probe: 2 });
    expect(logs).toContain(SCOPE_LEFT_LOGIN_URL_LOG);
  });

  // Companion to 008 for banks that authenticate without navigating: the
  // form leaves the screen while the URL stays put. Weaker evidence than a
  // moved URL — absence is only ever read as unknown — but it must still
  // stop the verdict.
  it('LOGIN-POST-OTP-009: form leaves the screen during the OTP probe → fall through', async () => {
    const mediator = makeMediator({ ...noOtpScenario, visibilityAnswers: [true, false] });
    const logs: string[] = [];
    const ctx = makeContext(loginUrl, passwordSelector, logs);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
    const counts = callCountsOf(mediator);
    expect(counts).toMatchObject({ visibility: 2, probe: 2 });
    expect(logs).toContain(SCOPE_TORN_DOWN_FALLTHROUGH_LOG);
  });

  // Pins URL-before-visibility precedence. Both signals say "gone", and the
  // URL must win: it is positive evidence of navigation, while an
  // unobservable form is only ever unknown. Without this, swapping the two
  // checks is invisible — both routes return false, so a verdict-only
  // assertion cannot tell them apart.
  //
  // `visibility: 1` is the load-bearing count: only the initial scope sample
  // read the DOM. Once the URL proves the browser navigated, the verdict must
  // short-circuit rather than probe a form that now lives on a detached
  // frame — the read most likely to hang or throw mid-navigation, and the one
  // whose answer could not be trusted anyway.
  it('LOGIN-POST-OTP-011: URL evidence outranks visibility evidence', async () => {
    const scripted = { urlAnswers: [loginUrl, authenticatedUrl], visibilityAnswers: [true, false] };
    const mediator = makeMediator({ ...noOtpScenario, ...scripted });
    const logs: string[] = [];
    const ctx = makeContext(loginUrl, passwordSelector, logs);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
    const counts = callCountsOf(mediator);
    expect(counts).toMatchObject({ url: 2, visibility: 1, probe: 2 });
    expect(logs).toContain(SCOPE_LEFT_LOGIN_URL_LOG);
    expect(logs).not.toContain(SCOPE_TORN_DOWN_FALLTHROUGH_LOG);
  });

  // Mutation guard for 008 and 009: the re-reads must not disarm the gate.
  // A login scope that STILL holds at the verdict is a real rejection and
  // must fail with INVALID_PASSWORD, or 008/009 would pass against a
  // validator that simply never fails. The call-count assertion pins that
  // both re-reads actually ran, so an inserted extra read cannot shift the
  // scripts under 008/009 and leave them green while covering nothing.
  it('LOGIN-POST-OTP-012: scope still holds at the verdict → INVALID_PASSWORD', async () => {
    const mediator = makeMediator({ ...noOtpScenario, visibilityAnswers: [true, true] });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expectInvalidPassword(result);
    const counts = callCountsOf(mediator);
    expect(counts).toMatchObject({ url: 2, visibility: 2 });
  });
});
