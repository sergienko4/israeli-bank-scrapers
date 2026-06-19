/**
 * REGRESSION GUARD — R3 HOME nav-override MUST stay target="_blank"-only.
 *
 * Locks the origin/main contract: a DIRECT home trigger receives a
 * `navHrefOverride` (replacing the click with a same-tab navigation)
 * ONLY when the anchor declares `target="_blank"`. An absolute href
 * WITHOUT `target="_blank"` is an ordinary link and MUST keep its click
 * path. PR #381 widened the rule to "any absolute href", hijacking
 * ordinary clicks across every bank's HOME phase.
 *
 * <p>Fire proof: GREEN on origin/main (target-only). RED against the
 * PR-381 HomeResolver (its `resolveNavOverrideHref` attaches the
 * override for any absolute href, so the no-blank expectation fails).
 *
 * <p>The mock implements BOTH `resolveVisible` (origin/main single-
 * winner path) and `resolveAllVisible` (the PR-381 enumerate path) so
 * the guard executes cleanly against either implementation and the only
 * difference observed is the override semantics under test.
 */

import type { Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import {
  NAV_STRATEGY,
  resolveHomeStrategy,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

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

/** An absolute href that is NOT a new-tab (`target="_blank"`) anchor. */
const ABSOLUTE_HREF = 'https://digital.example-bank.local/personalarea/Login/';

/** Per-attribute scripted values for the resolved trigger element. */
interface IAttrResponses {
  readonly target: string;
  readonly href: string;
}

/**
 * Build a mediator that always resolves one visible DIRECT trigger
 * ('Login') and answers scripted `target`/`href` attribute reads.
 * Implements both visibility methods so the guard runs on origin/main
 * (`resolveVisible`) and PR-381 (`resolveAllVisible`) alike.
 * @param responses - Per-attribute scripted values.
 * @returns Mock element mediator.
 */
function makePopupMediator(responses: IAttrResponses): IElementMediator {
  const visible: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const, value: 'Login' };
  return {
    /**
     * Single-winner visibility probe (origin/main path).
     * @returns The visible DIRECT trigger.
     */
    resolveVisible: (): Promise<IRaceResult> => Promise.resolve(visible),
    /**
     * Enumerate-N visibility probe (PR-381 path).
     * @returns A one-entry list holding the visible DIRECT trigger.
     */
    resolveAllVisible: (): Promise<readonly IRaceResult[]> => Promise.resolve([visible]),
    /**
     * checkAttribute returns true only for `href` (force DIRECT path).
     * @param _r - Race result.
     * @param attr - Attribute name.
     * @returns Succeeded with whether the attribute is present.
     */
    checkAttribute: (_r: IRaceResult, attr: string) => {
      const presence = succeed(attr === 'href');
      return Promise.resolve(presence);
    },
    /**
     * Per-attribute scripted value.
     * @param _r - Race result.
     * @param attr - Attribute name.
     * @returns Scripted value, or empty string for other attributes.
     */
    getAttributeValue: (_r: IRaceResult, attr: string): Promise<string> => {
      if (attr === 'target') return Promise.resolve(responses.target);
      if (attr === 'href') return Promise.resolve(responses.href);
      return Promise.resolve('');
    },
  } as unknown as IElementMediator;
}

/**
 * Minimal Page stub for `resolveHomeStrategy`.
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
 * Drive `resolveHomeStrategy` and assert PRE succeeded, returning the
 * discovery for override assertions.
 * @param responses - Per-attribute responses.
 * @returns Discovery value after PRE.
 */
async function runResolve(responses: IAttrResponses): Promise<IHomeDiscovery> {
  const mediator = makePopupMediator(responses);
  const pageStub = makePageStub();
  const result = await resolveHomeStrategy(mediator, SILENT_LOG, pageStub);
  const isResolved = isOk(result);
  expect(isResolved).toBe(true);
  if (!result.success) throw new ScraperError('HOME PRE expected to succeed in R3 guard');
  return result.value;
}

describe('REGRESSION GUARD — R3 nav-override stays target="_blank"-only', () => {
  it('does NOT attach navHrefOverride for an absolute href WITHOUT target="_blank"', async () => {
    const discovery = await runResolve({ target: '', href: ABSOLUTE_HREF });
    expect(discovery.strategy).toBe(NAV_STRATEGY.DIRECT);
    expect(discovery.navHrefOverride).toBeUndefined();
  });

  it('DOES attach navHrefOverride for a genuine target="_blank" anchor (positive control)', async () => {
    const discovery = await runResolve({ target: '_blank', href: ABSOLUTE_HREF });
    expect(discovery.navHrefOverride).toBe(ABSOLUTE_HREF);
  });
});
