/**
 * PR #385 — LOGIN.POST scope-intact in-flight settle guard (Amex).
 *
 * <p>Pins {@link validateActionScopeIntact}'s would-fail branch. Amex's
 * AngularJS login iframe keeps its auth XHR IN-FLIGHT at the instant of
 * the first OTP probe, so the one-time-code input is not yet painted
 * (`otpScreenVisible === false`) — indistinguishable from genuinely
 * invalid credentials, which ALSO yield `false`. Only TIME separates
 * them: an in-flight auth paints OTP / navigates once it settles; a
 * genuine-invalid login never transitions. The validator now awaits a
 * bounded network settle and RE-PROBES before failing, so a TRANSITIONING
 * state falls through while a STATIC `false` state still fails loud as
 * `INVALID_PASSWORD` (the PR #282 anti-masking contract, preserved).
 *
 * <p>Test Case IDs:
 *   - SCOPE-INFLIGHT-TC1: pre-settle false → post-settle true (transition)
 *     → fall through (NOT InvalidPassword). RED on HEAD 9d8c4dcf.
 *   - SCOPE-INFLIGHT-TC2: false BOTH pre- and post-settle (static invalid)
 *     → INVALID_PASSWORD (#282 anti-masking twin; GREEN before AND after).
 *   - SCOPE-INFLIGHT-TC3: OTP visible pre-settle → fall through BEFORE the
 *     settle (settle never entered).
 *   - SCOPE-INFLIGHT-TC4: URL changed (Isracard happy path) → scope-intact
 *     resolves false EARLY; settle + re-probe never entered.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
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

/** Scripted answer for a single `resolveVisible` (OTP-form) probe call. */
type ProbeAnswer = 'found' | 'not-found';

/** Observable side-effects the stub records so tests can assert the path. */
interface IMediatorSpy {
  /** Count of bounded-settle (`waitForNetworkIdle`) invocations. */
  settleCalls: number;
  /** Count of OTP-form probe (`resolveVisible`) invocations. */
  resolveVisibleCalls: number;
}

/** Configuration for the stub mediator's per-call answers. */
interface IMediatorConfig {
  readonly currentUrl: string;
  readonly passwordCount: number;
  /** Per-call OTP-probe answers consumed in invocation order. */
  readonly probeAnswers: readonly ProbeAnswer[];
}

/**
 * Stub IRaceResult carrying only the `found` flag the OTP probe reads.
 * @param wasFound - Whether the OTP code input resolved.
 * @returns Race-result-like shape with the {found} flag set.
 */
function raceResult(wasFound: boolean): IRaceResult {
  return { found: wasFound } as unknown as IRaceResult;
}

/**
 * Build a minimal IElementMediator stub plus a spy that records whether
 * the bounded settle + re-probe path was entered.
 * @param config - Scripted answers for this scenario.
 * @returns The mediator stub and its observable spy.
 */
function makeMediator(config: IMediatorConfig): { mediator: IElementMediator; spy: IMediatorSpy } {
  const spy: IMediatorSpy = { settleCalls: 0, resolveVisibleCalls: 0 };
  let callIndex = 0;
  const mediator = {
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
     * Yields the next scripted OTP-probe answer in call order. Falls back
     * to `not-found` once the script is exhausted.
     * @returns Race result per the scripted answer.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      const answer = config.probeAnswers[callIndex] ?? 'not-found';
      callIndex += 1;
      spy.resolveVisibleCalls += 1;
      const race = raceResult(answer === 'found');
      return Promise.resolve(race);
    },
    /**
     * No-op bounded network settle — records entry; the production code
     * awaits then ignores the resolved value.
     * @returns Resolved sentinel (settle complete).
     */
    waitForNetworkIdle: (): Promise<false> => {
      spy.settleCalls += 1;
      return Promise.resolve(false);
    },
  } as unknown as IElementMediator;
  return { mediator, spy };
}

/**
 * Build a minimal IPipelineContext stub with the fields
 * {@link validateActionScopeIntact} reads.
 * @param loginUrl - The login URL stored in diagnostics.
 * @param passwordSelector - Selector string used by the validator.
 * @param settleBudgetMs - Optional per-bank scope-intact poll budget (ms).
 *   When provided, the stub's `config.scopeIntactSettleBudgetMs` is set so
 *   the bounded poll runs enough iterations to cover in-flight auth scenarios
 *   (TC5). When absent, `config` is an empty object and the production code
 *   falls back to its default budget constant.
 * @returns Pipeline-context-shaped stub.
 */
function makeContext(
  loginUrl: string,
  passwordSelector: string,
  settleBudgetMs?: number,
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
  const config = settleBudgetMs !== undefined ? { scopeIntactSettleBudgetMs: settleBudgetMs } : {};
  return {
    diagnostics: { loginUrl },
    loginFieldDiscovery: some(discovery),
    config,
    logger: {
      /**
       * No-op debug sink — discards validator diagnostics.
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

describe('LOGIN.POST scope-intact — in-flight network settle re-probe (PR #385)', () => {
  const loginUrl = 'https://login.bank.fake.example/ng-portals/auth/he/';
  const passwordSelector = '#password';

  it('SCOPE-INFLIGHT-TC1: in-flight transition (false→true) → fall through, NOT InvalidPassword', async () => {
    // Pre-settle the OTP input is absent (auth XHR still in-flight);
    // post-settle it is painted. HEAD 9d8c4dcf probes ONCE → false →
    // fail(InvalidPassword) → RED. After the fix: settle, re-probe →
    // true → fall through (false).
    const { mediator } = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['not-found', 'found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });

  it('SCOPE-INFLIGHT-TC2: static invalid (false both probes) → INVALID_PASSWORD (#282 preserved)', async () => {
    // A genuinely-invalid login NEVER transitions during the settle, so
    // the same decision rule still fails loud — GREEN before AND after.
    const { mediator } = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['not-found', 'not-found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
      }
    }
  });

  it('SCOPE-INFLIGHT-TC3: OTP already visible pre-settle → fall through before the settle', async () => {
    const { mediator, spy } = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
    expect(spy.settleCalls).toBe(0);
    expect(spy.resolveVisibleCalls).toBe(1);
  });

  it('SCOPE-INFLIGHT-TC4: Isracard happy path (URL changed) → settle + re-probe never entered', async () => {
    const { mediator, spy } = makeMediator({
      currentUrl: 'https://login.bank.fake.example/dashboard/',
      passwordCount: 1,
      probeAnswers: [],
    });
    const ctx = makeContext(loginUrl, passwordSelector);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
    expect(spy.settleCalls).toBe(0);
    expect(spy.resolveVisibleCalls).toBe(0);
  });

  it('SCOPE-INFLIGHT-TC5: SLOW in-flight auth — 4 false polls then OTP painted → fall through', async () => {
    // Amex AngularJS auth XHR stays IN-FLIGHT for ~40 s (PR #385 trace).
    // The initial probe and 3 in-poll probes return not-found; only the 4th
    // poll iteration sees OTP painted. Current HEAD (single reprobe) stops at
    // probe 2 → InvalidPassword (RED). After the fix: budget
    // (scopeIntactSettleBudgetMs=10000ms / 2500ms interval = 4 iters) reaches
    // probe 5 → found → fall through (GREEN).
    const { mediator } = makeMediator({
      currentUrl: loginUrl,
      passwordCount: 1,
      probeAnswers: ['not-found', 'not-found', 'not-found', 'not-found', 'found'],
    });
    const ctx = makeContext(loginUrl, passwordSelector, 10000);
    const result = await validateActionScopeIntact(mediator, ctx);
    expect(result).toBe(false);
  });
});
