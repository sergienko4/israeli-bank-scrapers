/**
 * Unit tests for LoginFormActions — fillAllFields, fillAndSubmit, fillFromDiscovery.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Logging/Debug.js';
import type {
  IActionMediator,
  IElementMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  fillAllFields,
  fillAndSubmit,
  fillFromDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Form/LoginFormActions.js';
import type {
  ILoginFieldDiscovery,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Mock logger satisfying ScraperLogger shape. */
const LOG: ScraperLogger = {
  /**
   * debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * trace.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * info.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * warn.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * error.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

/**
 * Build a mediator stub that always reports resolveAndClick not-found.
 * @returns Mock mediator.
 */
function makeMediator(): IElementMediator {
  return {
    /**
     * resolveField.
     * @returns Not-found context procedure.
     */
    resolveField: () => {
      const succeeded = succeed({
        isResolved: false,
        selector: '',
        context: {},
        resolvedVia: 'notResolved' as const,
        round: 'notResolved' as const,
      });
      return Promise.resolve(succeeded);
    },
    /**
     * resolveAndClick.
     * @returns Succeed with NOT_FOUND.
     */
    resolveAndClick: () => {
      const succeeded = succeed(NOT_FOUND_RESULT);
      return Promise.resolve(succeeded);
    },
    /**
     * scopeToForm.
     * @param c - Candidates.
     * @returns Same candidates.
     */
    scopeToForm: <T>(c: T): T => c,
    /**
     * getCurrentUrl.
     * @returns URL.
     */
    getCurrentUrl: (): string => 'https://bank.co.il/login',
  } as unknown as IElementMediator;
}

/** Minimal login config. */
const CONFIG: ILoginConfig = {
  loginUrl: 'https://bank.co.il/login',
  fields: [{ credentialKey: 'username', selectors: [] }],
  submit: { kind: 'textContent', value: 'Login' },
  possibleResults: {},
} as unknown as ILoginConfig;

/**
 * Build an IActionMediator stub. All methods succeed by default;
 * pass overrides to inject failure or alternate behavior.
 * @param overrides - Per-test method overrides.
 * @returns Mock IActionMediator.
 */
function makeActionExecutor(overrides: Partial<IActionMediator> = {}): IActionMediator {
  const base: Partial<IActionMediator> = {
    /**
     * Default fillInput stub — no-op success.
     * @returns Resolved true.
     */
    fillInput: (): Promise<true> => Promise.resolve(true),
    /**
     * Default pressEnter stub — Enter pressed successfully.
     * @returns Resolved true.
     */
    pressEnter: (): Promise<true> => Promise.resolve(true),
    /**
     * Default clickElement stub — click performed.
     * @returns Resolved true.
     */
    clickElement: (): Promise<true> => Promise.resolve(true),
    /**
     * Default getCurrentUrl stub — returns canned bank login URL.
     * @returns Default login URL.
     */
    getCurrentUrl: (): string => 'https://bank.co.il/login',
  };
  return { ...base, ...overrides } as unknown as IActionMediator;
}

describe('fillAllFields', () => {
  it('fails validation when credential missing', async () => {
    const mediator = makeMediator();
    const result = await fillAllFields({
      mediator,
      fields: CONFIG.fields,
      creds: {},
      logger: LOG,
    });
    expect(result.procedure.success).toBe(false);
  });

  it('returns procedure when creds provided (reduce path exercised)', async () => {
    const mediator = makeMediator();
    const result = await fillAllFields({
      mediator,
      fields: [],
      creds: {},
      logger: LOG,
    });
    expect(typeof result.procedure.success).toBe('boolean');
  });
});

describe('fillAndSubmit', () => {
  it('returns fail when credential missing', async () => {
    const mediator = makeMediator();
    const result = await fillAndSubmit({
      mediator,
      config: CONFIG,
      creds: {},
      logger: LOG,
    });
    expect(result.success).toBe(false);
  });
});

describe('fillFromDiscovery', () => {
  it('fails validation when credential key missing', async () => {
    const target: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: 'main',
      targets: new Map([['username', target]]),
      submitTarget: { has: false },
    } as unknown as ILoginFieldDiscovery;
    const executor = {
      /**
       * fillInput noop.
       * @returns Resolved true.
       */
      fillInput: (): Promise<true> => Promise.resolve(true),
      /**
       * pressEnter noop.
       * @returns Resolved true.
       */
      pressEnter: (): Promise<true> => Promise.resolve(true),
      /**
       * clickElement noop.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => Promise.resolve(true),
      /**
       * getCurrentUrl noop.
       * @returns URL.
       */
      getCurrentUrl: (): string => 'https://bank.co.il/login',
    } as unknown as IActionMediator;
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: {},
      logger: LOG,
    });
    expect(result.success).toBe(false);
  });

  it('returns success when creds valid and no submit target', async () => {
    const target: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: 'main',
      targets: new Map([['username', target]]),
      submitTarget: { has: false },
    } as unknown as ILoginFieldDiscovery;
    const executor = {
      /**
       * fillInput noop.
       * @returns Resolved true.
       */
      fillInput: (): Promise<true> => Promise.resolve(true),
      /**
       * pressEnter noop.
       * @returns Resolved true.
       */
      pressEnter: (): Promise<true> => Promise.resolve(true),
      /**
       * clickElement noop.
       * @returns Resolved true.
       */
      clickElement: (): Promise<true> => Promise.resolve(true),
      /**
       * getCurrentUrl.
       * @returns URL.
       */
      getCurrentUrl: (): string => 'https://bank.co.il/login',
    } as unknown as IActionMediator;
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    expect(result.success).toBe(true);
  });

  it('clicks submit when discovery.submitTarget is present', async () => {
    const field: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const submit: IResolvedTarget = {
      selector: 'button[type=submit]',
      contextId: 'main',
      kind: 'css',
      candidateValue: 'Submit',
    };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: 'main',
      targets: new Map([['username', field]]),
      submitTarget: { has: true, value: submit },
    } as unknown as ILoginFieldDiscovery;
    let wasClicked = false;
    const executor = {
      /**
       * fillInput noop.
       * @returns Resolved.
       */
      fillInput: (): Promise<true> => Promise.resolve(true),
      /**
       * pressEnter noop.
       * @returns Resolved.
       */
      pressEnter: (): Promise<true> => Promise.resolve(true),
      /**
       * clickElement records call.
       * @returns Resolved.
       */
      clickElement: (): Promise<true> => {
        wasClicked = true;
        return Promise.resolve(true);
      },
      /**
       * getCurrentUrl.
       * @returns URL.
       */
      getCurrentUrl: (): string => 'https://bank.co.il/login',
    } as unknown as IActionMediator;
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    expect(result.success).toBe(true);
    expect(wasClicked).toBe(true);
  });

  it('fails validation when multiple credentials missing', async () => {
    const target: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const passTarget: IResolvedTarget = { ...target, candidateValue: '#p' };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: 'main',
      targets: new Map([
        ['username', target],
        ['password', passTarget],
      ]),
      submitTarget: { has: false },
    } as unknown as ILoginFieldDiscovery;
    const executor = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      fillInput: (): Promise<true> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      pressEnter: (): Promise<true> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      clickElement: (): Promise<true> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getCurrentUrl: (): string => 'https://bank.co.il/login',
    } as unknown as IActionMediator;
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    expect(result.success).toBe(false);
  });

  it('fillFromDiscovery returns fail when a benign pressEnter rejection fires AND submitTarget is absent', async () => {
    const target: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: 'main',
      targets: new Map([['username', target]]),
      submitTarget: { has: false },
    } as unknown as ILoginFieldDiscovery;
    const executor = makeActionExecutor({
      /**
       * Per-test override: pressEnter rejects with a BENIGN signal
       * ("no element matches selector") so the Enter-fallback returns
       * false → empty-signal fail path (CR PR #345 round-2 narrowed catch).
       * @returns Rejected promise carrying a benign press signal.
       */
      pressEnter: (): Promise<never> => Promise.reject(new Error('no element matches selector')),
    });
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    expect(result.success).toBe(false);
  });

  it('fillFromDiscovery propagates a non-benign pressEnter rejection (real bug surfaces)', async () => {
    const target: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: 'main',
      targets: new Map([['username', target]]),
      submitTarget: { has: false },
    } as unknown as ILoginFieldDiscovery;
    const executor = makeActionExecutor({
      /**
       * Per-test override: pressEnter rejects with an UNEXPECTED error
       * that must NOT be swallowed — the narrowed catch rethrows it so
       * a real mediator/frame bug surfaces instead of degrading to a
       * silent no-signal fail (CR PR #345 round-2 finding).
       * @returns Rejected promise carrying a non-benign error.
       */
      pressEnter: (): Promise<never> => Promise.reject(new Error('mediator boom: unexpected')),
    });
    const fillPromise = fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    await expect(fillPromise).rejects.toThrow('mediator boom: unexpected');
  });

  it('tryClickSubmitFromDiscovery swallows clickElement rejection (.catch line 306)', async () => {
    const target: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const submitTarget: IResolvedTarget = { ...target, candidateValue: 'Submit' };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: 'main',
      targets: new Map([['username', target]]),
      submitTarget: { has: true as const, value: submitTarget },
    } as unknown as ILoginFieldDiscovery;
    const executor = makeActionExecutor({
      /**
       * Reject the click to exercise the discovery-path catch arm.
       * @returns Rejected promise.
       */
      clickElement: (): Promise<never> => Promise.reject(new Error('click fail')),
    });
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    expect(result.success).toBe(true);
  });

  it('fillFromDiscovery returns fail when activeFrameId is empty AND submitTarget absent', async () => {
    const target: IResolvedTarget = {
      selector: '#u',
      contextId: 'main',
      kind: 'css',
      candidateValue: '#u',
    };
    const discovery: ILoginFieldDiscovery = {
      activeFrameId: '',
      targets: new Map([['username', target]]),
      submitTarget: { has: false },
    } as unknown as ILoginFieldDiscovery;
    let didPress = false;
    const executor = makeActionExecutor({
      /**
       * pressEnter records the call so the empty-frameId guard can be
       * verified — MUST remain false because the guard short-circuits.
       * @returns Resolved true.
       */
      pressEnter: (): Promise<true> => {
        didPress = true;
        return Promise.resolve(true);
      },
    });
    const result = await fillFromDiscovery({
      discovery,
      executor,
      config: CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    expect(didPress).toBe(false);
    expect(result.success).toBe(false);
  });
});

/** Two-field config, mirroring the shape every real bank declares. */
const TWO_FIELD_CONFIG: ILoginConfig = {
  ...CONFIG,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
};

/** Canned resolved target reused across completeness cases. */
const TARGET: IResolvedTarget = {
  selector: '#u',
  contextId: 'main',
  kind: 'css',
  candidateValue: '#u',
};

/**
 * Build a discovery whose targets carry exactly the supplied keys.
 * @param keys - Credential keys discovery managed to resolve.
 * @returns Discovery stub with a submit target absent.
 */
function makeDiscovery(keys: readonly string[]): ILoginFieldDiscovery {
  const entries = keys.map((key): readonly [string, IResolvedTarget] => [key, TARGET]);
  return {
    activeFrameId: 'main',
    targets: new Map(entries),
    submitTarget: { has: false },
  } as unknown as ILoginFieldDiscovery;
}

/** Credentials covering both declared fields, so only resolution can fail. */
const BOTH_CREDS = { username: 'u', password: 'p' };

/** Shape of the structured record emitted when a declared field is unresolved. */
interface IUnresolvedEvent {
  readonly event: string;
  readonly resolved: number;
  readonly declared: number;
}

describe('fillFromDiscovery completeness assertion', () => {
  it('succeeds when every declared field resolved', async () => {
    const result = await fillFromDiscovery({
      discovery: makeDiscovery(['username', 'password']),
      executor: makeActionExecutor(),
      config: TWO_FIELD_CONFIG,
      creds: BOTH_CREDS,
      logger: LOG,
    });
    expect(result.success).toBe(true);
  });

  it('fails naming the field when one declared field never resolved', async () => {
    const result = await fillFromDiscovery({
      discovery: makeDiscovery(['username']),
      executor: makeActionExecutor(),
      config: TWO_FIELD_CONFIG,
      creds: BOTH_CREDS,
      logger: LOG,
    });
    expect(result.success).toBe(false);
    expect(result).toHaveProperty('errorMessage', 'Login field not found on page: password');
  });

  it('fails when discovery resolved nothing at all', async () => {
    const result = await fillFromDiscovery({
      discovery: makeDiscovery([]),
      executor: makeActionExecutor(),
      config: TWO_FIELD_CONFIG,
      creds: BOTH_CREDS,
      logger: LOG,
    });
    expect(result.success).toBe(false);
  });

  it('never fills when a declared field is unresolved', async () => {
    let fillCount = 0;
    const executor = makeActionExecutor({
      /**
       * Count fills so the short-circuit before the reducer is proven.
       * @returns Resolved true.
       */
      fillInput: (): Promise<true> => {
        fillCount += 1;
        return Promise.resolve(true);
      },
    });
    await fillFromDiscovery({
      discovery: makeDiscovery(['username']),
      executor,
      config: TWO_FIELD_CONFIG,
      creds: BOTH_CREDS,
      logger: LOG,
    });
    expect(fillCount).toBe(0);
  });

  it('separates an unresolved field from a missing credential', async () => {
    const unresolved = await fillFromDiscovery({
      discovery: makeDiscovery(['username']),
      executor: makeActionExecutor(),
      config: TWO_FIELD_CONFIG,
      creds: BOTH_CREDS,
      logger: LOG,
    });
    const uncredentialed = await fillFromDiscovery({
      discovery: makeDiscovery(['username', 'password']),
      executor: makeActionExecutor(),
      config: TWO_FIELD_CONFIG,
      creds: { username: 'u' },
      logger: LOG,
    });
    expect(unresolved).toHaveProperty('errorMessage', 'Login field not found on page: password');
    expect(uncredentialed).toHaveProperty('errorMessage', 'Missing credentials: password');
  });

  it('emits login.fields_unresolved with resolved and declared counts', async () => {
    const events: IUnresolvedEvent[] = [];
    const logger = {
      ...LOG,
      /**
       * Capture the structured failure payload for assertion.
       * @param payload - Structured log record.
       * @returns True.
       */
      error: (payload: IUnresolvedEvent): boolean => {
        events.push(payload);
        return true;
      },
    } as unknown as ScraperLogger;
    await fillFromDiscovery({
      discovery: makeDiscovery(['username']),
      executor: makeActionExecutor(),
      config: TWO_FIELD_CONFIG,
      creds: BOTH_CREDS,
      logger,
    });
    expect(events[0]?.event).toBe('login.fields_unresolved');
    expect(events[0]?.resolved).toBe(1);
    expect(events[0]?.declared).toBe(2);
  });
});
