/**
 * Regression coverage for `detectLoginFormStillPresent` — the post-login
 * form-presence check.
 *
 * <p>Two compounding regressions in commit `d9636d8e`:
 *  - Selector too generic: `xpath=//input[@type="password"]` recorded by
 *    login.PRE matches the OTP step's password input (Isracard) → false
 *    positive InvalidPassword on a successful login.
 *  - Check fires too early: a 9 ms gap between URL change and the
 *    presence check is not enough for an SPA framework (Angular/React)
 *    to finish unmounting the login view → the dying-frame login form
 *    is still in the DOM.
 *
 * <p>Fix scope:
 *  - Form-anchor scoping: chain the trustworthy form-anchor selector
 *    in front of the password selector so the query targets only
 *    descendants of the login form.
 *  - Polling: wait up to 5 s with 500 ms ticks for the count to drop
 *    to 0 — gives the SPA time to finish teardown without false
 *    positives.
 *  - Timeout still produces a LOUD `fail(InvalidPassword)` so genuine
 *    invalid-credential paths (Hapoalim's gate test) keep failing.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { executeValidateLogin } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  ILoginFieldDiscovery,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithLogin,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

/** Minimal ILoginConfig shared across these regressions. */
const TEST_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
};

/**
 * Build the form-anchor option for the test context. Empty input means
 * "no anchor recorded by PRE" (Hapoalim/VisaCal); non-empty means PRE
 * captured a trustworthy anchor (Isracard's `#otpLobbyForm`).
 * @param formAnchorSelector - Anchor selector or empty string.
 * @returns Option-shaped form anchor for ILoginFieldDiscovery.
 */
function buildFormAnchor(formAnchorSelector: string): ILoginFieldDiscovery['formAnchor'] {
  const hasAnchor = formAnchorSelector.length > 0;
  if (!hasAnchor) return none();
  /**
   * Stub Page-shaped context for form anchor — only `url` is consulted
   * by the touched code paths in these tests.
   * @returns The about:blank URL string.
   */
  const fakeUrl = (): string => 'about:blank';
  const fakeContext = { url: fakeUrl };
  const anchor = {
    selector: formAnchorSelector,
    context: fakeContext,
  };
  return some(anchor) as unknown as ILoginFieldDiscovery['formAnchor'];
}

/**
 * Build a discovery whose recorded password is a generic xpath selector
 * (the Isracard / Amex / Max shape) and whose form anchor is optionally
 * trustworthy (id-based).
 * @param passwordSelector - Recorded by login.PRE.
 * @param formAnchorSelector - Trustworthy anchor selector or empty for no anchor.
 * @returns Configured login-field discovery.
 */
function makeDiscovery(passwordSelector: string, formAnchorSelector: string): ILoginFieldDiscovery {
  return {
    targets: new Map([
      [
        'password',
        {
          selector: passwordSelector,
          contextId: 'main',
          kind: 'placeholder',
          candidateValue: 'pwd',
        },
      ],
    ]),
    formAnchor: buildFormAnchor(formAnchorSelector),
    activeFrameId: 'main',
    submitTarget: none(),
  };
}

/**
 * Build a context carrying the discovery + a mock mediator with a
 * configured `countBySelector` stub.
 * @param mediator - Pre-built mock mediator.
 * @param discovery - Login-field discovery option contents.
 * @returns Pipeline context with login state and discovery wired in.
 */
function buildCtxWithDiscovery(
  mediator: ReturnType<typeof makeMockMediator>,
  discovery: ILoginFieldDiscovery,
): IPipelineContext {
  const page = makeScreenshotPage();
  const baseCtx = makeContextWithLogin(page);
  return { ...baseCtx, loginFieldDiscovery: some(discovery), mediator: some(mediator) };
}

/**
 * Variant: PRE captures BOTH `password` and `userCode` targets
 * (Hapoalim's shape). Used by the OR-gate Hapoalim regression
 * test below.
 *
 * @param passwordSelector - Recorded by login.PRE for the password input.
 * @param userCodeSelector - Recorded by login.PRE for the userCode input.
 * @param formAnchorSelector - Trustworthy anchor selector or empty.
 * @returns Configured login-field discovery with both fields.
 */
function makeDiscoveryHapoalim(
  passwordSelector: string,
  userCodeSelector: string,
  formAnchorSelector: string,
): ILoginFieldDiscovery {
  return {
    targets: new Map([
      [
        'password',
        {
          selector: passwordSelector,
          contextId: 'main',
          kind: 'placeholder',
          candidateValue: 'pwd',
        },
      ],
      [
        'userCode',
        {
          selector: userCodeSelector,
          contextId: 'main',
          kind: 'placeholder',
          candidateValue: 'usr',
        },
      ],
    ]),
    formAnchor: buildFormAnchor(formAnchorSelector),
    activeFrameId: 'main',
    submitTarget: none(),
  };
}

describe('detectLoginFormStillPresent — form-anchor scoping (Isracard regression)', () => {
  it('uses the form-anchor-scoped selector when the anchor is trustworthy', async () => {
    const seenSelectors: string[] = [];
    /**
     * Mock countBySelector mirroring the Isracard regression: the bare
     * generic xpath matches the OTP form's password input (returns 1)
     * but the login-form scoped selector returns 0 (login form was
     * destroyed).
     * @param selector - The selector being counted.
     * @returns 0 when scoped under `#otpLobbyForm`, 1 otherwise.
     */
    const countBySelector = (selector: string): Promise<number> => {
      seenSelectors.push(selector);
      const isScopedToLoginForm = selector.startsWith('#otpLobbyForm');
      return Promise.resolve(isScopedToLoginForm ? 0 : 1);
    };
    const mediator = makeMockMediator({ countBySelector });
    const discovery = makeDiscovery('xpath=//input[@type="password"]', '#otpLobbyForm');
    const ctx = buildCtxWithDiscovery(mediator, discovery);

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    /**
     * Predicate: did this selector use the form-anchor scope?
     * @param sel - Probed selector.
     * @returns Whether the selector starts with the anchor.
     */
    const isScoped = (sel: string): boolean => sel.startsWith('#otpLobbyForm');
    const hasUsedScopedQuery = seenSelectors.some(isScoped);
    expect(hasUsedScopedQuery).toBe(true);
  });

  it('LOG-POST-1 form is gone when ANY discovered field disappears (Hapoalim OTP-screen regression — PR #215 round 4)', async () => {
    // Hapoalim's case from PR #215 CI run 25581278915. The
    // bank-side flow accepts the credentials and shows the OTP
    // screen — confirmed by the user receiving a Hapoalim OTP
    // SMS (banks do NOT dispatch OTPs on rejected logins).
    //
    // Stage trace from the artifact pipeline.log:
    //   home.PRE/ACTION/POST/FINAL: OK
    //   login.PRE: OK — captures `#password` AND `#userCode`
    //   login.ACTION: OK — submit click
    //   login.POST: pre-OR-gate this FAIL'd —
    //     `#password count=1` after 5s → InvalidPassword.
    //     But `#password` is the OTP screen's masked-input
    //     digit field, not the login form.
    //
    // Form-anchor scoping cannot help here: Hapoalim's anchor
    // is bare `<form>` (rejected by `extractFormAnchorSelector`
    // as untrustworthy), so the probe falls back to unscoped
    // `#password`. The OTP screen retains a `#password`-id
    // input → false positive.
    //
    // The OR-gate fix: probe EVERY field PRE captured (password
    // + userCode) and treat the form as gone the moment ANY
    // field disappears. Hapoalim's OTP screen has no
    // `#userCode`, so the count drops to 0 and the gate
    // releases — `#password` staying on the OTP step is no
    // longer load-bearing.
    const seenSelectors: string[] = [];
    /**
     * Mock mirroring the OTP-screen case: `#password` remains
     * (count=1) but `#userCode` is gone (count=0). The OR-gate
     * predicate must release on ANY-field-gone, treating the
     * login form as torn down.
     * @param selector - The selector being counted.
     * @returns 0 for `#userCode`, 1 for `#password`.
     */
    const countBySelector = (selector: string): Promise<number> => {
      seenSelectors.push(selector);
      const isUserCode = selector === '#userCode' || selector.endsWith(' #userCode');
      return Promise.resolve(isUserCode ? 0 : 1);
    };
    const mediator = makeMockMediator({ countBySelector });
    const discovery = makeDiscoveryHapoalim('#password', '#userCode', 'form');
    const ctx = buildCtxWithDiscovery(mediator, discovery);

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    /**
     * Predicate: did the OR-gate probe `#userCode`? Without
     * this field being part of the predicate, the function
     * would only see `#password` count=1 forever and timeout.
     * @param sel - Selector probed by the predicate.
     * @returns Whether the selector targets userCode.
     */
    const isUserCodeProbe = (sel: string): boolean =>
      sel === '#userCode' || sel.endsWith(' #userCode');
    const hasUserCodeProbe = seenSelectors.some(isUserCodeProbe);
    expect(hasUserCodeProbe).toBe(true);
  });

  it('LOG-POST-2 OR-gate dedupes scoped selectors when multiple fields share the same scoping', async () => {
    // Edge case: PRE captures two fields whose scoped selectors
    // coincide (e.g. both fall back to the same unscoped form
    // when the anchor is untrustworthy). The dedupe path in
    // `foldScopedSelector` must collapse them so the probe runs
    // ONE per cycle instead of two.
    const seenSelectors: string[] = [];
    /**
     * Mock `countBySelector` recording every probe — used to
     * assert dedupe via the unique-set count.
     * @param selector - Selector being counted.
     * @returns 0 (form gone — unblocks the gate).
     */
    const countBySelector = (selector: string): Promise<number> => {
      seenSelectors.push(selector);
      return Promise.resolve(0);
    };
    const mediator = makeMockMediator({ countBySelector });
    // Both targets carry IDENTICAL selectors → after scoping
    // they produce one entry in the de-duped list.
    const discovery = makeDiscoveryHapoalim('#shared', '#shared', '');
    const ctx = buildCtxWithDiscovery(mediator, discovery);

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    const distinctProbed = new Set(seenSelectors);
    expect(distinctProbed.size).toBe(1);
  });

  it('LOG-POST-3 skips form-presence when discovery has zero targets', async () => {
    // Edge case: PRE produced an ILoginFieldDiscovery whose
    // targets map is empty (e.g. a test fixture or a future
    // bank with no field discovery yet wired). The collector
    // returns an empty selector list and the detector
    // short-circuits to `false` (no opinion on form presence)
    // — the rest of POST decides via the remaining gates.
    /**
     * Sentinel mock — should never be called when no targets.
     * @returns Always 99 (proves the function bailed before
     *   probing).
     */
    const countBySelector = (): Promise<number> => Promise.resolve(99);
    const mediator = makeMockMediator({ countBySelector });
    const emptyDiscovery: ILoginFieldDiscovery = {
      targets: new Map(),
      formAnchor: none(),
      activeFrameId: 'main',
      submitTarget: none(),
    };
    const ctx = buildCtxWithDiscovery(mediator, emptyDiscovery);

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('falls back to the unscoped selector when the form anchor is untrustworthy', async () => {
    const seenSelectors: string[] = [];
    /**
     * Mock that records what we probe. With the bare-tag form anchor
     * `form` rejected by the anchor extractor, the scoped path must
     * not be taken — every probe should match the original selector.
     * @param selector - The selector being counted.
     * @returns 0 (login form gone) for any selector.
     */
    const countBySelector = (selector: string): Promise<number> => {
      seenSelectors.push(selector);
      return Promise.resolve(0);
    };
    const mediator = makeMockMediator({ countBySelector });
    const discovery = makeDiscovery('#password', 'form');
    const ctx = buildCtxWithDiscovery(mediator, discovery);

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    const hasUsedUnscoped = seenSelectors.includes('#password');
    expect(hasUsedUnscoped).toBe(true);
  });
});

describe('detectLoginFormStillPresent — polling for SPA teardown', () => {
  it('resolves successfully once the count drops to 0 within the budget', async () => {
    let callCount = 0;
    /**
     * Simulates an SPA still tearing down: the first three polls return
     * 1 (login form lingering) and subsequent polls return 0 (unmount
     * completed). Proves the function polls instead of single-shot
     * probing.
     * @returns Number of matched elements per call.
     */
    const countBySelector = (): Promise<number> => {
      callCount += 1;
      const isFormGone = callCount > 3;
      return Promise.resolve(isFormGone ? 0 : 1);
    };
    const mediator = makeMockMediator({ countBySelector });
    const discovery = makeDiscovery('#password', '');
    const ctx = buildCtxWithDiscovery(mediator, discovery);

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(callCount).toBeGreaterThan(1);
  }, 30000);

  it('fails LOUDLY with InvalidPassword when count never drops within budget', async () => {
    let callCount = 0;
    /**
     * The genuine invalid-creds path — login form NEVER goes away. The
     * function must time out and return fail(InvalidPassword) so the
     * gate test (Hapoalim invalid-creds) still catches credential errors.
     * @returns Always 1 (login form persists).
     */
    const countBySelector = (): Promise<number> => {
      callCount += 1;
      return Promise.resolve(1);
    };
    const mediator = makeMockMediator({ countBySelector });
    const discovery = makeDiscovery('#password', '');
    const ctx = buildCtxWithDiscovery(mediator, discovery);

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(callCount).toBeGreaterThan(1);
  }, 30000);
});
