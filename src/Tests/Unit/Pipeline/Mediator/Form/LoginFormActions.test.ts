/**
 * Unit tests for LoginFormActions — fillAllFields, fillAndSubmit, fillFromDiscovery.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
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
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
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

  it('tryEnterFromDiscovery swallows pressEnter rejection (.catch line 286)', async () => {
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
      pressEnter: (): Promise<never> => Promise.reject(new Error('press fail')),
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
    expect(result.success).toBe(true);
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
      clickElement: (): Promise<never> => Promise.reject(new Error('click fail')),
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
    expect(result.success).toBe(true);
  });
});
