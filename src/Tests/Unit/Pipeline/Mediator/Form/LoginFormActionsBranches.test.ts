/**
 * Branch-gap tests for {@link fillAndSubmit} and {@link fillFromDiscovery}
 * plus the supporting {@link fillOneField}, {@link reduceField},
 * {@link validateCredentials}, and {@link fillFieldStep} helpers from
 * `LoginFormFill.ts` / `LoginScopeResolver.ts`. Phase 5d's orphan-prune
 * removed the legacy Pipeline LoginSteps tests that incidentally
 * covered these helpers; these branch tests reclaim coverage of the
 * surviving production module without re-introducing the dead orphans.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../../../Scrapers/Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  fillAndSubmit,
  fillFromDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Form/LoginFormActions.js';
import {
  fillOneField,
  reduceField,
  validateCredentials,
} from '../../../../../Scrapers/Pipeline/Mediator/Form/LoginFormFill.js';
import { fillFieldStep } from '../../../../../Scrapers/Pipeline/Mediator/Form/LoginScopeResolver.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import type {
  ILoginFieldDiscovery,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockFullPage } from '../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Failure beacon thrown by the assertion guards when `success: true` was expected. */
const ASSERT_SUCCESS_FAILED = 'fillFromDiscovery / fillAndSubmit returned failure';

/**
 * Build a no-op ScraperLogger satisfying the structured-logging contract
 * without emitting output during test runs.
 * @returns Logger stub whose methods short-circuit to `true`.
 */
function makeSilentLogger(): ScraperLogger {
  return {
    /**
     * debug no-op.
     * @returns True.
     */
    debug: (): boolean => true,
    /**
     * trace no-op.
     * @returns True.
     */
    trace: (): boolean => true,
    /**
     * info no-op.
     * @returns True.
     */
    info: (): boolean => true,
    /**
     * warn no-op.
     * @returns True.
     */
    warn: (): boolean => true,
    /**
     * error no-op.
     * @returns True.
     */
    error: (): boolean => true,
  } as unknown as ScraperLogger;
}

/** Hapoalim-shaped login config — username + password, Hebrew submit text. */
const HAPOALIM_CONFIG = {
  loginUrl: 'https://login.bankhapoalim.co.il/login',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: { kind: 'textContent', value: 'כניסה' },
  possibleResults: {},
} as unknown as ILoginConfig;

/**
 * Hapoalim-shaped login config with NO fields. Lets fillAllFields skip
 * the reduce loop (no DOM probes), so tests can exercise the post-fill
 * submit-method branches without standing up a Page-shaped Playwright
 * stub. validateCredentials reports success when `fields: []` and
 * `creds: {}`, matching the source's `findMissingKeys` predicate.
 */
const HAPOALIM_CONFIG_NO_FIELDS = {
  loginUrl: 'https://login.bankhapoalim.co.il/login',
  fields: [],
  submit: { kind: 'textContent', value: 'כניסה' },
  possibleResults: {},
} as unknown as ILoginConfig;

/**
 * Build an IRaceResult that simulates a successful click winner for the
 * Hebrew login submit candidate.
 * @returns Race result with `found: true` and a populated candidate.
 */
function makeFoundClickResult(): IRaceResult {
  return {
    found: true,
    locator: false,
    candidate: { kind: 'textContent', value: 'כניסה' },
    context: false,
    index: 0,
    value: 'כניסה',
    identity: false,
  };
}

/** Field-resolution stub returned by the LoginFormActions mediator. */
const UNRESOLVED_FIELD_PROCEDURE = succeed({
  isResolved: false,
  selector: '',
  context: {},
  resolvedVia: 'notResolved' as const,
  round: 'notResolved' as const,
});

/**
 * Build an IElementMediator whose `resolveAndClick` returns the supplied
 * race result and whose Page-frame methods report a Hapoalim URL.
 * @param clickResult - Pre-baked race result returned by resolveAndClick.
 * @returns Mediator stub for fillAndSubmit tests.
 */
function makeMediator(clickResult: IRaceResult): IElementMediator {
  const clickProcedure = succeed(clickResult);
  return {
    /**
     * resolveField returns the canned non-resolved field. Used only by
     * fillAllFields when the test passes a non-empty `fields` config —
     * the SUBMIT_METHOD_MAP tests use `fields: []` so this stub is
     * effectively a no-op there.
     * @returns Procedure with an unresolved-context payload.
     */
    resolveField: () => Promise.resolve(UNRESOLVED_FIELD_PROCEDURE),
    /**
     * resolveAndClick mirrors the supplied race result so each test can
     * pick either a hit ({found:true}) or miss ({found:false, NOT_FOUND_RESULT}).
     * @returns Procedure wrapping the supplied result.
     */
    resolveAndClick: () => Promise.resolve(clickProcedure),
    /**
     * getFormAnchor reports no anchor — exercises the LoginScopeResolver's
     * "no form scoping" branch inside tryClickSubmit.
     * @returns Empty anchor string.
     */
    getFormAnchor: (): string => '',
    /**
     * scopeToForm passthrough.
     * @param candidates - Original candidates.
     * @returns Same candidates.
     */
    scopeToForm: <T>(candidates: T): T => candidates,
    /**
     * getCurrentUrl reports the post-submit Hapoalim URL.
     * @returns Production-shaped URL string.
     */
    getCurrentUrl: (): string => 'https://login.bankhapoalim.co.il/dashboard',
  } as unknown as IElementMediator;
}

/**
 * Build the canonical username/password discovery payload from PRE so
 * fillFromDiscovery has both targets present and the submit-target slot
 * controlled by `withSubmit`.
 * @param withSubmit - When true, attach a resolved submit target.
 * @returns Login-field discovery fixture.
 */
function makeDiscovery(withSubmit: boolean): ILoginFieldDiscovery {
  const username: IResolvedTarget = {
    selector: '#username',
    contextId: 'main',
    kind: 'css',
    candidateValue: 'username',
  };
  const password: IResolvedTarget = {
    selector: '#password',
    contextId: 'main',
    kind: 'css',
    candidateValue: 'password',
  };
  const targets = new Map<string, IResolvedTarget>([
    ['username', username],
    ['password', password],
  ]);
  if (!withSubmit) {
    return {
      activeFrameId: 'main',
      targets,
      submitTarget: { has: false },
    } as unknown as ILoginFieldDiscovery;
  }
  const submit: IResolvedTarget = {
    selector: 'button[type="submit"]',
    contextId: 'main',
    kind: 'css',
    candidateValue: 'submit',
  };
  return {
    activeFrameId: 'main',
    targets,
    submitTarget: { has: true, value: submit },
  } as unknown as ILoginFieldDiscovery;
}

/** Production-shaped Hapoalim credentials — both keys mapped to non-empty values. */
const HAPOALIM_CREDS: Record<string, string> = {
  username: 'isradigit-12345',
  password: 'Hapoalim!2026',
};

/** Behavior selector for the executor's clickElement stub. */
type ClickMode = 'resolve' | 'reject';

/** Pre-built clickElement implementations keyed by ClickMode (S3923/S3358 fix). */
const CLICK_HANDLERS: Record<ClickMode, () => Promise<true>> = {
  /**
   * resolve variant — emulates a Playwright click landing cleanly.
   * @returns Resolved true.
   */
  resolve: (): Promise<true> => Promise.resolve(true),
  /**
   * reject variant — exercises the catch arm:
   *   `.clickElement({...}).catch((): false => false);`
   * @returns Rejected ScraperError (cast to Promise of true for the union).
   */
  reject: (): Promise<true> => Promise.reject(new ScraperError('click fail')),
};

/** Behavior selector for the executor's pressEnter stub. */
type PressMode = 'resolve' | 'reject';

/** Pre-built pressEnter implementations keyed by PressMode. */
const PRESS_HANDLERS: Record<PressMode, () => Promise<true>> = {
  /**
   * resolve variant — emulates Playwright Enter dispatched without error.
   * @returns Resolved true.
   */
  resolve: (): Promise<true> => Promise.resolve(true),
  /**
   * reject variant — exercises the catch arm:
   *   `executor.pressEnter(...).catch((): false => false);`
   * @returns Rejected ScraperError (cast to Promise of true for the union).
   */
  reject: (): Promise<true> => Promise.reject(new ScraperError('press fail')),
};

/** Bundle for {@link makeExecutor} — selects which CLICK/PRESS handler to install. */
interface IExecutorSpec {
  /** Press-Enter behavior. */
  readonly press: PressMode;
  /** ClickElement behavior. */
  readonly click: ClickMode;
}

/**
 * Build an action-mediator executor whose `pressEnter` and `clickElement`
 * resolve or reject per the supplied mode flags. Map-driven so the
 * factory body avoids the nested-ternary lint pattern (S3358) and the
 * identical-branches false positive (S3923).
 * @param spec - Behavior selectors for pressEnter and clickElement.
 * @returns Executor stub satisfying {@link IActionMediator}.
 */
function makeExecutor(spec: IExecutorSpec): IActionMediator {
  return {
    /**
     * fillInput no-op — credential filling is exercised by the broader
     * LoginFormActions test; this stub only needs to keep the reduce
     * accumulator moving.
     * @returns Resolved true.
     */
    fillInput: (): Promise<true> => Promise.resolve(true),
    /** pressEnter dispatched from the {@link PRESS_HANDLERS} table. */
    pressEnter: PRESS_HANDLERS[spec.press],
    /** clickElement dispatched from the {@link CLICK_HANDLERS} table. */
    clickElement: CLICK_HANDLERS[spec.click],
    /**
     * getCurrentUrl reports the post-submit Hapoalim URL.
     * @returns Production-shaped URL string.
     */
    getCurrentUrl: (): string => 'https://login.bankhapoalim.co.il/dashboard',
  } as unknown as IActionMediator;
}

/**
 * Convenience preset — executor whose pressEnter and clickElement both
 * resolve cleanly. Models the happy-path Hapoalim discovery flow where
 * Enter dispatches and the submit-target click lands. Centralises the
 * duplicated `makeExecutor({ press: 'resolve', click: 'resolve' })`
 * call sites per CLAUDE.md "factory functions for test mocks".
 *
 * @returns IActionMediator with both submit paths wired to succeed.
 */
function makeDefaultExecutor(): IActionMediator {
  return makeExecutor({ press: 'resolve', click: 'resolve' });
}

describe('LoginFormActions.tryEnterSubmit — frameCtx + press branch coverage', () => {
  it('presses Enter when frameCtx is a Page-shaped object with press()', async (): Promise<void> => {
    // Source line in tryEnterSubmit:
    //   `if (!frameCtx || !('press' in frameCtx)) return false;`
    //   `await frameCtx.press('input', 'Enter').catch(...);`
    // Hapoalim happy path: fillAllFields successfully resolves the
    // password field → frameContext becomes the resolved Page. The
    // tryEnterSubmit guard's BOTH conjuncts evaluate to truthy, so the
    // function reaches `frameCtx.press(...)` (not the early-return).
    // The test captures the press invocation to prove the guard's
    // truthy arm fired.
    let didPress = false;
    const fullPage = makeMockFullPage();
    // Wrap the mock page so we can capture the press call AND ensure
    // 'press' in frameCtx is true. Object spread keeps the own
    // property visible to the `in` operator.
    /**
     * Press capture — flips didPress so the assertion verifies the
     * non-guard branch ran inside tryEnterSubmit.
     * @returns Resolved void.
     */
    const pressFn = (): Promise<void> => {
      didPress = true;
      return Promise.resolve();
    };
    const pageWithPress = { ...fullPage, press: pressFn };
    // Mediator: resolveField returns a SUCCESS context tied to pageWithPress
    // so fillOneField → deepFillInput runs against the same frame, and
    // fillResult.frameContext === pageWithPress.
    const fieldCtx = {
      selector: '#password',
      context: pageWithPress as unknown as object,
      resolvedKind: 'placeholder',
      resolvedVia: 'placeholder',
    };
    const resolveOk = succeed(fieldCtx);
    const noAnchor = { has: false as const };
    // resolveAndClick reports NOT_FOUND_RESULT so tryClickSubmit returns
    // succeed(false) and the SUBMIT_METHOD_MAP['true-false'] arm fires.
    const clickOk = succeed(NOT_FOUND_RESULT);
    const mediator = {
      /**
       * Resolve the password field successfully.
       * @returns Success procedure.
       */
      resolveField: () => Promise.resolve(resolveOk),
      /**
       * Return none so discoverScope's no-anchor arm fires.
       * @returns None option.
       */
      discoverForm: () => Promise.resolve(noAnchor),
      /**
       * Return NOT_FOUND so tryClickSubmit reports succeed(false).
       * @returns Procedure wrapping NOT_FOUND_RESULT.
       */
      resolveAndClick: () => Promise.resolve(clickOk),
      /**
       * No form anchor.
       * @returns Empty selector.
       */
      getFormAnchor: (): string => '',
      /**
       * Static post-submit URL.
       * @returns URL.
       */
      getCurrentUrl: (): string => 'https://login.bankhapoalim.co.il/dashboard',
    } as unknown as IElementMediator;
    const singleFieldConfig: ILoginConfig = {
      ...HAPOALIM_CONFIG,
      fields: [PASSWORD_FIELD],
    };
    const logger = makeSilentLogger();
    const result = await fillAndSubmit({
      mediator,
      config: singleFieldConfig,
      creds: { password: 'Hapoalim!2026' },
      logger,
    });
    if (!result.success) throw new ScraperError(ASSERT_SUCCESS_FAILED);
    // Enter fired AND click missed → SUBMIT_METHOD_MAP['true-false'] = 'enter'.
    expect(result.value.method).toBe('enter');
    expect(didPress).toBe(true);
  });
});

describe('LoginFormActions.fillAndSubmit — resolveAndClick failure propagation', () => {
  it('returns the failure Procedure when resolveAndClick fails and Enter never fired', async (): Promise<void> => {
    // Source lines:
    //   `if (!result.success) return result;`  (tryClickSubmit, line 114)
    //   `if (!clickResult.success && !didEnter) return clickResult;`  (fillAndSubmit, line 144)
    // Hapoalim password flow with a transient mediator-resolver
    // outage (network blip): `mediator.resolveAndClick` returns a
    // fail Procedure → tryClickSubmit propagates it, and because
    // `fields: []` skipped the fill loop → didEnter=false → the
    // failure is returned. Guards against the resolver leaking
    // unhandled exceptions past the await boundary.
    const clickFailure = fail(ScraperErrorTypes.Generic, 'resolveAndClick: transient timeout');
    const failingMediator = {
      /**
       * Returns an unresolved field — fillAllFields short-circuits
       * via fields:[] anyway, so this is defensive.
       * @returns Unresolved procedure.
       */
      resolveField: () => Promise.resolve(UNRESOLVED_FIELD_PROCEDURE),
      /**
       * Returns a fail Procedure so tryClickSubmit hits line 114.
       * @returns Failure procedure.
       */
      resolveAndClick: () => Promise.resolve(clickFailure),
      /**
       * No form anchor — keeps tryClickSubmit on the simple path.
       * @returns Empty anchor string.
       */
      getFormAnchor: (): string => '',
      /**
       * getCurrentUrl no-op.
       * @returns Production URL.
       */
      getCurrentUrl: (): string => 'https://login.bankhapoalim.co.il/dashboard',
    } as unknown as IElementMediator;
    const logger = makeSilentLogger();
    const result = await fillAndSubmit({
      mediator: failingMediator,
      config: HAPOALIM_CONFIG_NO_FIELDS,
      creds: {},
      logger,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('resolveAndClick: transient timeout');
    }
  });
});

describe('LoginFormActions.fillAndSubmit — SUBMIT_METHOD_MAP branch coverage', () => {
  /**
   * SUBMIT_METHOD_MAP entries exercised through fillAndSubmit. Both
   * cases share the `fillAllFields → fields=[]` short-circuit that
   * drops `didEnter` to false; the click resolver toggles `didClick`
   * (`makeFoundClickResult` → true → `'false-true'` → 'click';
   * `NOT_FOUND_RESULT` → false → gated FAILURE via `gateNoSubmitSignal`
   * per CR4 #5, since "no Enter AND no real Click" must NOT phantom-
   * succeed). Per CLAUDE.md's "config arrays mapped with .map()" rule.
   */
  const submitMethodCases = [
    {
      label: "returns 'click' when Enter fails and click hits",
      clickResult: makeFoundClickResult(),
      shouldSucceed: true,
      expectedMethod: 'click' as const,
    },
    {
      label: 'fails via gateNoSubmitSignal when both Enter and click miss',
      clickResult: NOT_FOUND_RESULT,
      shouldSucceed: false,
      expectedMethod: undefined,
    },
  ] as const;

  submitMethodCases.forEach(({ label, clickResult, shouldSucceed, expectedMethod }) => {
    it(`resolveSubmitMethod ${label}`, async (): Promise<void> => {
      const mediator = makeMediator(clickResult);
      const logger = makeSilentLogger();
      const result = await fillAndSubmit({
        mediator,
        config: HAPOALIM_CONFIG_NO_FIELDS,
        creds: {},
        logger,
      });
      expect(result.success).toBe(shouldSucceed);
      if (result.success) {
        expect(result.value.method).toBe(expectedMethod);
      } else {
        expect(result.errorMessage).toContain('No submit signal fired');
      }
    });
  });
});

describe('LoginFormActions.fillFromDiscovery — submitTarget tri-state', () => {
  it('clicks pre-resolved submit target when discovery.submitTarget.has is true', async (): Promise<void> => {
    // Exercises tryClickSubmitFromDiscovery's source line:
    //   `if (!discovery.submitTarget.has) return false;`
    //   `const target = discovery.submitTarget.value;`
    // With `withSubmit=true`, discovery.submitTarget.value resolves and
    // the executor's clickElement MUST fire. The captured `wasClicked`
    // boolean proves the truthy branch runs (rather than the early-return).
    const discovery = makeDiscovery(true);
    let wasClicked = false;
    const executor = {
      /**
       * fillInput no-op.
       * @returns Resolved true.
       */
      fillInput: (): Promise<true> => Promise.resolve(true),
      /**
       * pressEnter no-op.
       * @returns Resolved true.
       */
      pressEnter: (): Promise<true> => Promise.resolve(true),
      /**
       * clickElement records the invocation so the assertion can verify
       * the submit-target branch ran end-to-end.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        wasClicked = true;
        return Promise.resolve(true);
      },
      /**
       * getCurrentUrl no-op.
       * @returns URL.
       */
      getCurrentUrl: (): string => 'https://login.bankhapoalim.co.il/dashboard',
    } as unknown as IActionMediator;
    const logger = makeSilentLogger();
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: HAPOALIM_CONFIG,
      creds: HAPOALIM_CREDS,
      logger,
    });
    expect(result.success).toBe(true);
    expect(wasClicked).toBe(true);
  });

  it('skips submit click when discovery.submitTarget.has is false', async (): Promise<void> => {
    // Exercises the early-return line in tryClickSubmitFromDiscovery:
    //   `if (!discovery.submitTarget.has) return false;`
    // With `withSubmit=false`, clickElement MUST NOT run — Enter still
    // fires (pressEnter records `didEnter=true`), so success is reported
    // with the 'enter' method.
    const discovery = makeDiscovery(false);
    let wasClicked = false;
    const executor = {
      /**
       * fillInput no-op.
       * @returns Resolved true.
       */
      fillInput: (): Promise<true> => Promise.resolve(true),
      /**
       * pressEnter resolves so `didEnter=true`.
       * @returns Resolved true.
       */
      pressEnter: (): Promise<true> => Promise.resolve(true),
      /**
       * clickElement records the invocation — must remain false.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => {
        wasClicked = true;
        return Promise.resolve(true);
      },
      /**
       * getCurrentUrl no-op.
       * @returns URL.
       */
      getCurrentUrl: (): string => 'https://login.bankhapoalim.co.il/dashboard',
    } as unknown as IActionMediator;
    const logger = makeSilentLogger();
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: HAPOALIM_CONFIG,
      creds: HAPOALIM_CREDS,
      logger,
    });
    expect(result.success).toBe(true);
    expect(wasClicked).toBe(false);
  });

  it('returns success when clickElement rejects (catch arm swallows error)', async (): Promise<void> => {
    // Exercises tryClickSubmitFromDiscovery's catch arm:
    //   `.clickElement({...}).catch((): false => false);`
    // The function still returns `true` even when clickElement rejects,
    // so fillFromDiscovery reports overall success — Enter+click both
    // counted as having fired. This guards against the executor
    // rejection bubbling up and corrupting the submit-method lookup.
    const discovery = makeDiscovery(true);
    const executor = makeExecutor({ press: 'resolve', click: 'reject' });
    const logger = makeSilentLogger();
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: HAPOALIM_CONFIG,
      creds: HAPOALIM_CREDS,
      logger,
    });
    if (!result.success) throw new ScraperError(ASSERT_SUCCESS_FAILED);
    expect(result.value.success).toBe(true);
  });

  it("reports method='both' when Enter and click both fire", async (): Promise<void> => {
    // Exercises SUBMIT_METHOD_MAP `'true-true': 'both'`.
    // pressEnter resolves AND tryClickSubmitFromDiscovery hits the
    // submit-target branch (clickResolves:true). The reported method
    // MUST be 'both', distinguishing the happy-path POST validation
    // from the single-fire fallbacks.
    const discovery = makeDiscovery(true);
    const executor = makeDefaultExecutor();
    const logger = makeSilentLogger();
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: HAPOALIM_CONFIG,
      creds: HAPOALIM_CREDS,
      logger,
    });
    if (!result.success) throw new ScraperError(ASSERT_SUCCESS_FAILED);
    expect(result.value.method).toBe('both');
  });

  it("reports method='enter' when Enter fires but submit target absent", async (): Promise<void> => {
    // Exercises SUBMIT_METHOD_MAP `'true-false': 'enter'`. With no
    // submitTarget, tryClickSubmitFromDiscovery returns false → didClick
    // is false → method must be the lookup-map's 'enter' value, not
    // the fallback. Distinguishes Enter-only banks (Hapoalim password
    // flow) from click-driven banks (Max Angular submit button).
    const discovery = makeDiscovery(false);
    const executor = makeDefaultExecutor();
    const logger = makeSilentLogger();
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: HAPOALIM_CONFIG,
      creds: HAPOALIM_CREDS,
      logger,
    });
    if (!result.success) throw new ScraperError(ASSERT_SUCCESS_FAILED);
    expect(result.value.method).toBe('enter');
  });
});

// ─── LoginFormFill helper coverage (was indirectly exercised by deleted Login*Steps tests)

/** Username field config used by the LoginFormFill branch tests. */
const USERNAME_FIELD: IFieldConfig = { credentialKey: 'username', selectors: [] };

/** Password field config used by the LoginFormFill branch tests. */
const PASSWORD_FIELD: IFieldConfig = { credentialKey: 'password', selectors: [] };

describe('LoginFormFill.validateCredentials — credential-presence guard', () => {
  it('returns succeed(true) when every field has a non-empty credential', (): void => {
    // Source line:
    //   `if (missing.length > 0) { ... return fail(...); }`
    //   `return succeed(true);`
    // Production happy path — both fields supplied, so findMissingKeys
    // emits an empty array and the guard returns success.
    const creds = { username: 'isradigit-12345', password: 'Hapoalim!2026' };
    const result = validateCredentials([USERNAME_FIELD, PASSWORD_FIELD], creds);
    expect(result.success).toBe(true);
  });

  it('reports the first missing key with a wrapped fail Procedure', (): void => {
    // Source lines:
    //   `const missing = findMissingKeys(fields, creds);`
    //   `if (missing.length > 0) { const keys = missing.join(', ');`
    //   `  return fail(ScraperErrorTypes.Generic, \`Missing credentials: ${keys}\`); }`
    // Hapoalim flow with only username supplied — password missing.
    // The wrapper must NOT throw and the error message must carry the
    // missing key so debugging is deterministic.
    const credsOnlyUsername = { username: 'isradigit-12345' };
    const result = validateCredentials([USERNAME_FIELD, PASSWORD_FIELD], credsOnlyUsername);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('password');
    }
  });

  it('lists every missing key (comma-separated) when both are absent', (): void => {
    // Source line:
    //   `const keys = missing.join(', ');`
    // Both fields unsupplied → both should surface so the operator sees
    // the full deficit, not just the first failure.
    const result = validateCredentials([USERNAME_FIELD, PASSWORD_FIELD], {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('username');
      expect(result.errorMessage).toContain('password');
    }
  });
});

describe('LoginFormFill.reduceField — accumulator short-circuit', () => {
  it('returns the accumulator unchanged when the previous procedure has already failed', async (): Promise<void> => {
    // Source line:
    //   `if (!acc.procedure.success) return acc;`
    // A previously-failed reduce step MUST NOT call fillFieldStep —
    // the failure has to propagate to the caller intact. The reducer
    // is the only place in the fill chain where a missing-credential
    // error can short-circuit, so this branch is load-bearing.
    const failureProcedure = fail(ScraperErrorTypes.Generic, 'Missing credential: password');
    const acc = { scope: {}, procedure: failureProcedure };
    const prev = Promise.resolve(acc);
    // No mediator stub is needed because fillFieldStep MUST NOT run.
    const ctx = {
      mediator: {} as unknown as IElementMediator,
      creds: { username: 'isradigit-12345' },
      logger: makeSilentLogger(),
    };
    const result = await reduceField(ctx, prev, PASSWORD_FIELD);
    expect(result.procedure.success).toBe(false);
    // The accumulator object is returned by reference — proves the
    // early-return arm fired (not the fillFieldStep arm).
    expect(result).toBe(acc);
  });
});

describe('LoginFormFill.fillOneField + LoginScopeResolver.fillFieldStep — resolve-failure path', () => {
  it('returns isOk=false procedure when mediator.resolveField fails', async (): Promise<void> => {
    // Source line in fillOneField:
    //   `if (!result.success) return { isOk: false, procedure: result };`
    // Hapoalim invalid-creds telemetry: the resolver returns a failure
    // Procedure → fillOneField propagates without attempting fill. No
    // deepFillInput call → no Playwright Page locator dependency.
    const resolverFailure = fail(ScraperErrorTypes.Generic, 'mock: not found');
    const failingMediator = {
      /**
       * Always fails — exercises the early-return path.
       * @returns Failure procedure.
       */
      resolveField: () => Promise.resolve(resolverFailure),
    } as unknown as IElementMediator;
    const logger = makeSilentLogger();
    const result = await fillOneField({
      mediator: failingMediator,
      fill: { credentialKey: 'password', value: 'Hapoalim!2026', selectors: [] },
      logger,
    });
    expect(result.isOk).toBe(false);
    expect(result.procedure.success).toBe(false);
  });

  it('fillFieldStep propagates failure procedure when fillOneField returns isOk=false', async (): Promise<void> => {
    // Source line in fillFieldStep:
    //   `if (!result.isOk) return { scope, procedure: result.procedure };`
    // Same resolve-failure branch reached one layer up — the scope
    // accumulator must NOT be advanced when the field resolution
    // fails, so the caller's reduce loop short-circuits correctly.
    const resolverFailure = fail(ScraperErrorTypes.Generic, 'mock: not found');
    const failingMediator = {
      /**
       * Always fails so fillFieldStep's `if (!result.isOk)` arm fires.
       * @returns Failure procedure.
       */
      resolveField: () => Promise.resolve(resolverFailure),
    } as unknown as IElementMediator;
    const ctx = {
      mediator: failingMediator,
      creds: { password: 'Hapoalim!2026' },
      logger: makeSilentLogger(),
    };
    const initialScope = {};
    const result = await fillFieldStep(ctx, PASSWORD_FIELD, initialScope);
    expect(result.procedure.success).toBe(false);
    // The scope object is returned by reference — proves the
    // short-circuit arm fired without scope updates.
    expect(result.scope).toBe(initialScope);
  });

  it('fillFieldStep returns succeed + leaves scope alone when scope.ctx is already set', async (): Promise<void> => {
    // Source lines in updateScopeAfterFill:
    //   `if (scope.ctx || !args.result.resolvedContext) return { scope, procedure: succeed(true) };`
    // When scope.ctx is already present, the helper MUST short-circuit
    // (no second discoverForm probe) and return the un-mutated scope.
    // Production reduce loop relies on this so a previously-discovered
    // form anchor is not overwritten by a later field's frame context.
    const fullPage = makeMockFullPage();
    const fieldCtx = {
      selector: '#password',
      context: fullPage,
      resolvedKind: 'placeholder',
      resolvedVia: 'placeholder',
    };
    const resolveOk = succeed(fieldCtx);
    const okMediator = {
      /**
       * Always resolves so fillOneField returns isOk=true.
       * @returns Success procedure carrying the field context.
       */
      resolveField: () => Promise.resolve(resolveOk),
      /**
       * Reports no form anchor — irrelevant for this branch (scope.ctx
       * already set short-circuits BEFORE discoverScope runs).
       * @returns None option.
       */
      discoverForm: () => Promise.resolve({ has: false }),
    } as unknown as IElementMediator;
    const ctx = {
      mediator: okMediator,
      creds: { password: 'Hapoalim!2026' },
      logger: makeSilentLogger(),
    };
    // scope.ctx already populated → exercises the truthy arm of the
    // `scope.ctx || !args.result.resolvedContext` predicate.
    const preexistingScope = { ctx: fullPage };
    const result = await fillFieldStep(ctx, PASSWORD_FIELD, preexistingScope);
    expect(result.procedure.success).toBe(true);
    expect(result.scope.ctx).toBe(fullPage);
  });

  it('fillFieldStep advances scope.ctx + discovers form anchor on first field', async (): Promise<void> => {
    // Source lines in updateScopeAfterFill:
    //   `let nextScope: IFieldScope = { ...scope, ctx: args.result.resolvedContext };`
    //   `nextScope = await discoverScope(args.ctx, args.field, nextScope);`
    // First-field happy path: scope.ctx is undefined → updateScopeAfterFill
    // promotes the resolved frame to nextScope and runs discoverScope.
    // The mediator returns a form anchor → discoverScope assigns the
    // formSelector → caller's reduce loop carries it to subsequent fields.
    const fullPage = makeMockFullPage();
    const fieldCtx = {
      selector: '#password',
      context: fullPage,
      resolvedKind: 'placeholder',
      resolvedVia: 'placeholder',
    };
    const resolveOk = succeed(fieldCtx);
    const formAnchor = { selector: '#loginForm', context: fullPage };
    const someAnchor = { has: true as const, value: formAnchor };
    const okMediator = {
      /**
       * Resolves the field successfully for both fillOneField and
       * discoverScope's second `resolveField` invocation.
       * @returns Success procedure carrying the field context.
       */
      resolveField: () => Promise.resolve(resolveOk),
      /**
       * Returns a present anchor option so the
       * `if (!anchor.has) return scope;` arm is skipped and the
       * scope.formSelector is assigned.
       * @returns Some(anchor) option.
       */
      discoverForm: () => Promise.resolve(someAnchor),
    } as unknown as IElementMediator;
    const ctx = {
      mediator: okMediator,
      creds: { password: 'Hapoalim!2026' },
      logger: makeSilentLogger(),
    };
    const result = await fillFieldStep(ctx, PASSWORD_FIELD, {});
    expect(result.procedure.success).toBe(true);
    expect(result.scope.ctx).toBe(fullPage);
    expect(result.scope.formSelector).toBe('#loginForm');
  });

  it('fillFieldStep leaves formSelector unset when discoverForm returns none', async (): Promise<void> => {
    // Source line in discoverScope:
    //   `if (!anchor.has) return scope;`
    // Banks like Discount with no trustworthy form id surface here:
    // resolveField succeeds, but discoverForm yields `none()` → scope
    // is returned without a formSelector. Subsequent fields then scan
    // page-wide (the safe default).
    const fullPage = makeMockFullPage();
    const fieldCtx = {
      selector: '#password',
      context: fullPage,
      resolvedKind: 'placeholder',
      resolvedVia: 'placeholder',
    };
    const resolveOk = succeed(fieldCtx);
    const noAnchor = { has: false as const };
    const okMediator = {
      /**
       * Resolves the field successfully.
       * @returns Success procedure carrying the field context.
       */
      resolveField: () => Promise.resolve(resolveOk),
      /**
       * Returns the none() anchor option so discoverScope's
       * `if (!anchor.has) return scope;` arm fires.
       * @returns None option.
       */
      discoverForm: () => Promise.resolve(noAnchor),
    } as unknown as IElementMediator;
    const ctx = {
      mediator: okMediator,
      creds: { password: 'Hapoalim!2026' },
      logger: makeSilentLogger(),
    };
    const result = await fillFieldStep(ctx, PASSWORD_FIELD, {});
    expect(result.procedure.success).toBe(true);
    expect(result.scope.ctx).toBe(fullPage);
    expect(result.scope.formSelector).toBeUndefined();
  });
});
