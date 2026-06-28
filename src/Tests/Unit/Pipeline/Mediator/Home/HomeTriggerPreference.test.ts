/**
 * HOME trigger accessible-name preference — the DETERMINISTIC regression lock
 * for the cross-bank HOME-resolution bug the Bank Leumi migration exposed.
 *
 * <p>The live bug: Leumi's marketing home carries the login name "כניסה לחשבון"
 * on THREE nodes — a hidden `display:none` decoy `<a href="#">`, a no-href page
 * WRAPPER div (the `textContent` candidate walks up to `//div[.//text()=…]`),
 * and the real `<a class="enter_account" href="hb2.bankleumi.co.il/…">`. A
 * single-winner / first-visible pick lands on the no-href wrapper → classified
 * SEQUENTIAL → no navigation. The provider-agnostic fix enumerates the visible
 * matches and PREFERS the one matched by accessible name (`kind: 'ariaLabel'`),
 * which resolves only the genuine interactive control → DIRECT.
 *
 * <p>This unit test feeds {@link resolveHomeStrategy} a CONTROLLED, ordered
 * result list with the no-href wrapper FIRST and the real anchor SECOND. It is
 * the trustworthy guard the captured fixtures could not be: it FAILS the moment
 * the accessible-name preference is dropped (first-result would pick the wrapper
 * → SEQUENTIAL), and PASSES only while the fix selects the real anchor → DIRECT.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
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
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const LOGIN_NAME = 'כניסה לחשבון';
const LEUMI_LOGIN_HREF = 'https://hb2.bankleumi.co.il/H/Login.html';

const NO_OP_LOGGER: ScraperLogger = {
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

/**
 * Build a visible {@link IRaceResult} matched by the given candidate kind.
 * @param kind - Candidate kind that produced the match (`ariaLabel`/`textContent`).
 * @returns A found race result tagged with the candidate.
 */
function makeMatch(kind: SelectorCandidate['kind']): IRaceResult {
  const candidate = { kind, value: LOGIN_NAME } as SelectorCandidate;
  return { ...NOT_FOUND_RESULT, found: true as const, value: LOGIN_NAME, candidate };
}

/**
 * Stub page — HOME resolution reads only `url()`/`frames()`.
 * @returns Mock page.
 */
function makePage(): Page {
  return {
    /**
     * Mock url().
     * @returns Leumi marketing home URL.
     */
    url: (): string => 'https://www.leumi.co.il/he',
    /**
     * Mock frames().
     * @returns Empty frame list.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

/**
 * Build a mediator whose `resolveAllVisible` returns the EXACT ordered list,
 * resolving each result's href via `hrefOf` (so classification keys off the
 * PICKED result, not a global value). The wrapper has no href; the real anchor
 * has the absolute Leumi login href.
 * @param ordered - Visible matches in deterministic order (wrapper first).
 * @param hrefOf - Maps a result to its href ('' when it has none).
 * @returns Typed mediator stub for {@link resolveHomeStrategy}.
 */
function makeOrderedMediator(
  ordered: readonly IRaceResult[],
  hrefOf: (result: IRaceResult) => string,
): IElementMediator {
  return {
    /**
     * resolveAllVisible — returns the deterministic ordered match list.
     * @returns The ordered visible matches.
     */
    resolveAllVisible: (): Promise<readonly IRaceResult[]> => Promise.resolve(ordered),
    /**
     * checkAttribute — reports `href` present only when the picked result has one.
     * @param r - The picked race result.
     * @param attr - Attribute name being probed.
     * @returns Succeed with presence boolean.
     */
    checkAttribute: (r: IRaceResult, attr: string) => {
      const hasHref = attr === 'href' && hrefOf(r) !== '';
      const succeeded = succeed(hasHref);
      return Promise.resolve(succeeded);
    },
    /**
     * getAttributeValue — returns the picked result's href (or '').
     * @param r - The picked race result.
     * @param attr - Attribute name being read.
     * @returns The href value when asked, else ''.
     */
    getAttributeValue: (r: IRaceResult, attr: string): Promise<string> =>
      Promise.resolve(attr === 'href' ? hrefOf(r) : ''),
  } as unknown as IElementMediator;
}

describe('HOME trigger — accessible-name preference (cross-bank regression lock)', () => {
  it('prefers the real-href anchor (ariaLabel) over a no-href wrapper listed FIRST → DIRECT', async () => {
    const wrapper = makeMatch('textContent');
    const anchor = makeMatch('ariaLabel');
    const mediator = makeOrderedMediator([wrapper, anchor], r =>
      r === anchor ? LEUMI_LOGIN_HREF : '',
    );
    const page = makePage();
    const result = await resolveHomeStrategy(mediator, NO_OP_LOGGER, page);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.strategy).toBe(NAV_STRATEGY.DIRECT);
      expect(result.value.navHrefOverride).toBe(LEUMI_LOGIN_HREF);
    }
  });

  it('falls back to the first visible match when none is matched by accessible name', async () => {
    const toggle = makeMatch('textContent');
    const mediator = makeOrderedMediator([toggle], () => '');
    const page = makePage();
    const result = await resolveHomeStrategy(mediator, NO_OP_LOGGER, page);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.strategy).toBe(NAV_STRATEGY.SEQUENTIAL);
  });
});
