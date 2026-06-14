/**
 * Unit tests for HomeCrashRecovery — client-side-crash detection and the
 * reload-and-retry recovery path used by HOME.PRE.
 *
 * Edge-case coverage (the happy login flow is exercised by integration /
 * E2E suites): crash passthrough, reload+retry success, reload+retry
 * failure, raw detection, and the success short-circuit that keeps the
 * ordinary path zero-overhead.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Logging/Debug.js';
import {
  type IElementMediator,
  type IRaceResult,
  NOT_FOUND_RESULT,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  detectClientCrash,
  type IHomeRecoveryArgs,
  recoverFromClientCrash,
  resolveHomeWithRecovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeCrashRecovery.js';
import {
  type IHomeDiscovery,
  NAV_STRATEGY,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { fail, type Procedure, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const LOG: ScraperLogger = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * No-op warn.
   * @returns True.
   */
  warn: (): boolean => true,
} as unknown as ScraperLogger;

/** Mutable spy accumulator for mediator side effects. */
interface IRecoveryCalls {
  navigateTo: number;
}

/** Behaviour script for {@link makeRecoveryMediator}. */
interface IRecoveryScript {
  /** Per-call resolveVisible results (dequeued in order; empty → NOT_FOUND). */
  readonly visibleQueue?: readonly IRaceResult[];
  /** Value returned by every countByText probe (>0 ⇒ crash present). */
  readonly crashCount?: number;
  /** Scripted href value for the resolved trigger. */
  readonly hrefValue?: string;
  /** Attribute presence map for checkAttribute. */
  readonly attrsByName?: Record<string, boolean>;
  /** When true, navigateTo (the reload) resolves to a failure Procedure. */
  readonly navigateFails?: boolean;
}

/** Reload failure returned when a script sets `navigateFails`. */
const RELOAD_FAIL: Procedure<void> = fail(ScraperErrorTypes.Generic, 'reload failed');

/**
 * Build a scripted mediator stub for recovery tests.
 * @param script - Behaviour description.
 * @param calls - Spy accumulator mutated on navigateTo.
 * @returns Mock mediator.
 */
function makeRecoveryMediator(script: IRecoveryScript, calls: IRecoveryCalls): IElementMediator {
  const queue = [...(script.visibleQueue ?? [])];
  const attrs = script.attrsByName ?? {};
  return {
    /**
     * resolveVisible — dequeues scripted results.
     * @returns Next queued result or NOT_FOUND.
     */
    resolveVisible: (): Promise<IRaceResult> => Promise.resolve(queue.shift() ?? NOT_FOUND_RESULT),
    /**
     * countByText — scripted crash-marker count.
     * @returns Configured count.
     */
    countByText: (): Promise<number> => Promise.resolve(script.crashCount ?? 0),
    /**
     * navigateTo — records the reload and succeeds.
     * @returns Succeed(void).
     */
    navigateTo: (): Promise<Procedure<void>> => {
      calls.navigateTo += 1;
      const outcome = script.navigateFails ? RELOAD_FAIL : succeed(undefined);
      return Promise.resolve(outcome);
    },
    /**
     * checkAttribute — scripted attribute presence.
     * @param _r - Race result (unused).
     * @param attr - Attribute name.
     * @returns Succeed with presence boolean.
     */
    checkAttribute: (_r: IRaceResult, attr: string): Promise<Procedure<boolean>> => {
      const present = succeed(attrs[attr] ?? false);
      return Promise.resolve(present);
    },
    /**
     * getAttributeValue — scripted href value.
     * @returns Configured href value.
     */
    getAttributeValue: (): Promise<string> => Promise.resolve(script.hrefValue ?? ''),
  } as unknown as IElementMediator;
}

/**
 * Mock page returning no frames.
 * @returns Mock page.
 */
function makePage(): Page {
  return {
    /**
     * URL.
     * @returns Test bank URL.
     */
    url: (): string => 'https://test.bank',
    /**
     * frames.
     * @returns Empty.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

/**
 * Assemble recovery args around a scripted mediator.
 * @param mediator - Mock mediator.
 * @returns Recovery args bound to the test page + base URL.
 */
function makeArgs(mediator: IElementMediator): IHomeRecoveryArgs {
  return { mediator, logger: LOG, page: makePage(), baseUrl: 'https://test.bank' };
}

/** Found DIRECT trigger (real href) for retry-success scenarios. */
const DIRECT_TRIGGER: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Login' };

/** Attribute map that classifies the trigger as DIRECT. */
const DIRECT_ATTRS = { href: true, 'data-toggle': false, 'data-bs-toggle': false } as const;

/** Reusable original failure mirroring HomeResolver's NO_LOGIN_LINK_FAIL. */
const ORIGINAL_FAIL: Procedure<IHomeDiscovery> = fail(
  ScraperErrorTypes.Generic,
  'HOME PRE: no login nav link found',
);

describe('detectClientCrash', () => {
  it('returns true when a crash marker is present', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator({ crashCount: 2 }, calls);
    expect(await detectClientCrash(mediator)).toBe(true);
  });

  it('returns false when no crash marker is present', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator({ crashCount: 0 }, calls);
    expect(await detectClientCrash(mediator)).toBe(false);
  });
});

describe('recoverFromClientCrash', () => {
  it('passes the original failure through without reloading when no crash', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator({ crashCount: 0 }, calls);
    const args = makeArgs(mediator);
    const result = await recoverFromClientCrash(args, ORIGINAL_FAIL);
    expect(result.success).toBe(false);
    expect(calls.navigateTo).toBe(0);
  });

  it('reloads then recovers discovery when a crash boundary is detected', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator(
      {
        crashCount: 1,
        visibleQueue: [DIRECT_TRIGGER],
        attrsByName: { ...DIRECT_ATTRS },
        hrefValue: 'https://test.bank/login',
      },
      calls,
    );
    const args = makeArgs(mediator);
    const result = await recoverFromClientCrash(args, ORIGINAL_FAIL);
    expect(result.success).toBe(true);
    expect(calls.navigateTo).toBe(1);
    if (result.success) expect(result.value.strategy).toBe(NAV_STRATEGY.DIRECT);
  });

  it('reloads once and still fails when the retry finds no trigger', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator({ crashCount: 1, visibleQueue: [] }, calls);
    const args = makeArgs(mediator);
    const result = await recoverFromClientCrash(args, ORIGINAL_FAIL);
    expect(result.success).toBe(false);
    expect(calls.navigateTo).toBe(1);
  });

  it('returns the original failure when the reload itself fails', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator(
      { crashCount: 1, visibleQueue: [DIRECT_TRIGGER], navigateFails: true },
      calls,
    );
    const args = makeArgs(mediator);
    const result = await recoverFromClientCrash(args, ORIGINAL_FAIL);
    expect(result).toBe(ORIGINAL_FAIL);
    expect(calls.navigateTo).toBe(1);
  });
});

describe('resolveHomeWithRecovery', () => {
  it('returns first-pass success with zero overhead (no crash probe/reload)', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator(
      {
        crashCount: 0,
        visibleQueue: [DIRECT_TRIGGER],
        attrsByName: { ...DIRECT_ATTRS },
        hrefValue: 'https://test.bank/login',
      },
      calls,
    );
    const args = makeArgs(mediator);
    const result = await resolveHomeWithRecovery(args);
    expect(result.success).toBe(true);
    expect(calls.navigateTo).toBe(0);
  });

  it('heals a crashed first pass via reload-and-retry', async () => {
    const calls: IRecoveryCalls = { navigateTo: 0 };
    const mediator = makeRecoveryMediator(
      {
        crashCount: 1,
        visibleQueue: [NOT_FOUND_RESULT, DIRECT_TRIGGER],
        attrsByName: { ...DIRECT_ATTRS },
        hrefValue: 'https://test.bank/login',
      },
      calls,
    );
    const args = makeArgs(mediator);
    const result = await resolveHomeWithRecovery(args);
    expect(result.success).toBe(true);
    expect(calls.navigateTo).toBe(1);
  });
});
