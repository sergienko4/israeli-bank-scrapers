/**
 * PR #299 — HOME `target="_blank"` popup-follow branch coverage.
 *
 * Per testing-organization-guidlines.md §end ("integreation test over
 * unit test. unitest for adge cases only") these are edge-case unit
 * tests for the new branches added by `attachPopupNavOverride` in
 * HomeResolver and `fireTriggerAction` in HomeActions.Navigate. The
 * full user-observable behaviour is verified by the Mock-E2E
 * integration test in `src/Tests/E2eMocked/HomeTargetBlankPopup.*`.
 *
 * Tests target ONLY the new conditional branches the popup-follow
 * patch introduced; everything else is covered by the pre-existing
 * `HomeResolver.test.ts` + `HomeActionSrp.test.ts`.
 */

import type { Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { executeHomeNavigation } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import {
  NAV_STRATEGY,
  resolveHomeStrategy,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import type { IResolvedTarget } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeRecordingExecutor } from './HomeActionSrpRecorder.js';

const SILENT_LOG = {
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

const REAL_HREF = 'https://digital.example-bank.local/personalarea/Login/';

/** Bundled attribute responses keyed by attr name. */
interface IAttrResponses {
  readonly target: string;
  readonly href: string;
}

/**
 * Build a mediator whose `getAttributeValue` returns the scripted
 * value for the requested attribute name. Always returns DIRECT
 * (real href; no `data-toggle`) so the popup-follow branches are
 * the only ones under test.
 * @param responses - Per-attribute scripted values.
 * @returns Mock mediator.
 */
function makePopupMediator(responses: IAttrResponses): IElementMediator {
  const visible: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Login' };
  return {
    /**
     * resolveVisible.
     * @returns Visible result.
     */
    resolveVisible: (): Promise<IRaceResult> => Promise.resolve(visible),
    /**
     * resolveAllVisible — no extra entries (prefer-direct keeps primary).
     * @returns Empty list so the SEQUENTIAL primary winner is preserved.
     */
    resolveAllVisible: (): Promise<readonly IRaceResult[]> => Promise.resolve([]),
    /**
     * checkAttribute returns true only for `href` (force DIRECT path).
     * @param _r - Race result.
     * @param attr - Attribute name.
     * @returns Succeeded with whether attribute is present.
     */
    checkAttribute: (_r: IRaceResult, attr: string) => {
      const isHrefAttr = attr === 'href';
      const successResult = succeed(isHrefAttr);
      return Promise.resolve(successResult);
    },
    /**
     * Per-attribute scripted value.
     * @param _r - Race result.
     * @param attr - Attribute name.
     * @returns Scripted value or empty string.
     */
    getAttributeValue: (_r: IRaceResult, attr: string): Promise<string> => {
      if (attr === 'target') return Promise.resolve(responses.target);
      if (attr === 'href') return Promise.resolve(responses.href);
      return Promise.resolve('');
    },
  } as unknown as IElementMediator;
}

/**
 * Build a minimal Page stub for `resolveHomeStrategy`.
 * @returns Page stub.
 */
function makePageStub(): Page {
  return {
    /**
     * URL.
     * @returns Static URL.
     */
    url: (): string => 'https://www.example-bank.local/',
    /**
     * frames.
     * @returns Empty frame list.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

/**
 * Drive `resolveHomeStrategy` with the popup mediator + assert PRE
 * succeeded. Returns the discovered value for branch assertions.
 * @param responses - Per-attribute responses.
 * @returns Discovery value after PRE.
 */
async function runResolveExpectingOk(responses: IAttrResponses): Promise<IHomeDiscovery> {
  const mediator = makePopupMediator(responses);
  const pageStub = makePageStub();
  const result = await resolveHomeStrategy(mediator, SILENT_LOG, pageStub);
  const isOkResult = isOk(result);
  expect(isOkResult).toBe(true);
  if (!result.success)
    throw new ScraperError('PRE expected to succeed in popup-follow branch test');
  return result.value;
}

describe('HomeResolver — popup-follow override (PR #299)', () => {
  it('attaches navHrefOverride when DIRECT trigger has target="_blank" and a real href', async () => {
    const discovery = await runResolveExpectingOk({ target: '_blank', href: REAL_HREF });
    expect(discovery.strategy).toBe(NAV_STRATEGY.DIRECT);
    expect(discovery.navHrefOverride).toBe(REAL_HREF);
  });

  it('does NOT attach navHrefOverride when target attribute is missing (target !== "_blank")', async () => {
    const discovery = await runResolveExpectingOk({ target: '', href: REAL_HREF });
    expect(discovery.navHrefOverride).toBeUndefined();
  });

  it('does NOT attach navHrefOverride when target="_blank" but href is empty', async () => {
    const discovery = await runResolveExpectingOk({ target: '_blank', href: '' });
    expect(discovery.navHrefOverride).toBeUndefined();
  });
});

/**
 * Build a DIRECT discovery carrying the optional navHrefOverride.
 * @param override - Optional href override.
 * @returns IHomeDiscovery DIRECT.
 */
function makeDirectDiscovery(override?: string): IHomeDiscovery {
  const triggerTarget: IResolvedTarget = {
    contextId: 'main',
    selector: '[id="popup-link"]',
    kind: 'attribute',
    candidateValue: 'popup-link',
  };
  return {
    strategy: NAV_STRATEGY.DIRECT,
    triggerText: 'Login',
    triggerTarget,
    navHrefOverride: override,
  };
}

describe('HomeActions.Navigate — fireTriggerAction routing (PR #299)', () => {
  it('when navHrefOverride is set, ACTION calls executor.navigateTo(href) and DOES NOT click', async () => {
    const discovery = makeDirectDiscovery(REAL_HREF);
    const recorder = makeRecordingExecutor({ initialUrl: 'https://www.example-bank.local/' });
    const didNavigate = await executeHomeNavigation(recorder.executor, discovery, SILENT_LOG);
    expect(didNavigate).toBe(true);
    expect(recorder.navigateLog).toEqual([{ url: REAL_HREF }]);
    expect(recorder.clickLog).toEqual([]);
  });

  it('when navHrefOverride is undefined, ACTION clicks the triggerTarget identity selector (no navigateTo)', async () => {
    const discovery = makeDirectDiscovery();
    const recorder = makeRecordingExecutor({ initialUrl: 'https://www.example-bank.local/' });
    recorder.setOnClick((): true => recorder.setUrl('https://www.example-bank.local/login'));
    const didNavigate = await executeHomeNavigation(recorder.executor, discovery, SILENT_LOG);
    expect(didNavigate).toBe(true);
    expect(recorder.navigateLog).toEqual([]);
    expect(recorder.clickLog).toHaveLength(1);
    expect(recorder.clickLog[0].selector).toBe('[id="popup-link"]');
  });
});
