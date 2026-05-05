/**
 * Unit tests for HomeResolver — passive discovery + strategy classification.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  NAV_STRATEGY,
  resolveHomeStrategy,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { fail, isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const LOG: ScraperLogger = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * No-op trace.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * No-op info.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * No-op warn.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * No-op error.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

/** Options for the mock mediator. */
interface IMediatorScript {
  readonly visibleResult?: IRaceResult;
  readonly visibleRejects?: boolean;
  readonly attrsByName?: Record<string, boolean>;
  readonly hrefValue?: string;
}

/**
 * Build a mediator stub for HomeResolver.
 * @param script - Behaviour.
 * @returns Mock mediator.
 */
function makeMediator(script: IMediatorScript = {}): IElementMediator {
  const attrs = script.attrsByName ?? {};
  return {
    /**
     * resolveVisible.
     * @returns Scripted result or rejection.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      if (script.visibleRejects) return Promise.reject(new Error('boom'));
      return Promise.resolve(script.visibleResult ?? NOT_FOUND_RESULT);
    },
    /**
     * checkAttribute — returns attr present/absent per script.
     * @param _r - IRaceResult (unused).
     * @param attr - Attribute name.
     * @returns Succeed with boolean.
     */
    checkAttribute: (_r: IRaceResult, attr: string) => {
      const hasAttr = attrs[attr] ?? false;
      const succeeded = succeed(hasAttr);
      return Promise.resolve(succeeded);
    },
    /**
     * getAttributeValue — returns scripted href value.
     * @returns Scripted.
     */
    getAttributeValue: (): Promise<string> => Promise.resolve(script.hrefValue ?? ''),
  } as unknown as IElementMediator;
}

/**
 * Build a mock page with frames() returning empty.
 * @returns Mock page.
 */
function makePage(): Page {
  return {
    /**
     * URL.
     * @returns Empty URL.
     */
    url: (): string => 'https://bank.example.com',
    /**
     * frames.
     * @returns Empty.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

describe('resolveHomeStrategy', () => {
  it('fails with Generic error when no entry is visible', async () => {
    const mediator = makeMediator();
    const makePageResult1 = makePage();
    const result = await resolveHomeStrategy(mediator, LOG, makePageResult1);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('fails gracefully when resolveVisible rejects', async () => {
    const mediator = makeMediator({ visibleRejects: true });
    const makePageResult3 = makePage();
    const result = await resolveHomeStrategy(mediator, LOG, makePageResult3);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(false);
  });

  it('classifies DIRECT when element has a real href', async () => {
    const visible: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Login' };
    const mediator = makeMediator({
      visibleResult: visible,
      attrsByName: { href: true, 'data-toggle': false, 'data-bs-toggle': false },
      hrefValue: 'https://bank.example.com/login',
    });
    const makePageResult5 = makePage();
    const result = await resolveHomeStrategy(mediator, LOG, makePageResult5);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
    if (result.success) expect(result.value.strategy).toBe(NAV_STRATEGY.DIRECT);
  });

  it('classifies MODAL when href is fake and data-toggle present', async () => {
    const visible: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Login' };
    const mediator = makeMediator({
      visibleResult: visible,
      attrsByName: { href: true, 'data-toggle': true },
      hrefValue: '#',
    });
    const makePageResult7 = makePage();
    const result = await resolveHomeStrategy(mediator, LOG, makePageResult7);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
    if (result.success) expect(result.value.strategy).toBe(NAV_STRATEGY.MODAL);
  });

  it('classifies MODAL when data-bs-toggle present (second attribute)', async () => {
    const visible: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Login' };
    const mediator = makeMediator({
      visibleResult: visible,
      attrsByName: { href: true, 'data-toggle': false, 'data-bs-toggle': true },
      hrefValue: 'javascript:void(0)',
    });
    const makePageResult9 = makePage();
    const result = await resolveHomeStrategy(mediator, LOG, makePageResult9);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
    if (result.success) expect(result.value.strategy).toBe(NAV_STRATEGY.MODAL);
  });

  it('classifies SEQUENTIAL when fake href and no modal attributes', async () => {
    const visible: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Menu' };
    const mediator = makeMediator({
      visibleResult: visible,
      attrsByName: { href: true, 'data-toggle': false, 'data-bs-toggle': false },
      hrefValue: 'javascript:;',
    });
    const makePageResult11 = makePage();
    const result = await resolveHomeStrategy(mediator, LOG, makePageResult11);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
    if (result.success) {
      expect(result.value.strategy).toBe(NAV_STRATEGY.SEQUENTIAL);
      expect(result.value.menuCandidates.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats missing href attribute as not real-href (DIRECT fallback fails)', async () => {
    const visible: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Login' };
    const mediator = {
      ...makeMediator({
        visibleResult: visible,
        attrsByName: { href: false, 'data-toggle': false, 'data-bs-toggle': false },
      }),
      /**
       * checkAttribute returns a failure for all attrs.
       * @returns Fail.
       */
      checkAttribute: () => {
        const failed = fail(ScraperErrorTypes.Generic, 'no attr');
        return Promise.resolve(failed);
      },
    } as unknown as IElementMediator;
    const makePageResult13 = makePage();
    const result = await resolveHomeStrategy(mediator, LOG, makePageResult13);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
    if (result.success) expect(result.value.strategy).toBe(NAV_STRATEGY.SEQUENTIAL);
  });
});
