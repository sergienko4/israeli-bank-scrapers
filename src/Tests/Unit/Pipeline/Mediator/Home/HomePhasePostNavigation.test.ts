/**
 * T-HOMENAV — HOME POST's login-area decision.
 *
 * <p>This is the layer that was missing. HOME's POST gate accepts any ONE of
 * three signals, and its navigation signal compared a browser-normalized URL
 * against a bare-origin config value — so it was `true` for every bank on every
 * run and HOME could not fail. A phase that cannot fail never reaches the
 * pipeline's sanitization pulse, which is what re-runs the interceptors to clear
 * a late-appearing overlay and retries the phase. Max sat in exactly that hole.
 *
 * <p>T-HOMENAV-1 and T-HOMENAV-5 fail against the previous `!==` comparison.
 */

import type { Frame, Page } from 'playwright-core';

import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Logging/Debug.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { executeValidateLoginArea } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.Validate.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Bank homepage exactly as a registry config records it — no trailing slash. */
const HOMEPAGE = 'https://www.bank.example';

/** What the browser reports for that same page. */
const HOMEPAGE_NORMALIZED = 'https://www.bank.example/';

/** Silent logger — assertions carry the diagnostics. */
const SILENT = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
} as unknown as ScraperLogger;

/** One HOME POST scenario. */
interface IHomeNavCase {
  readonly id: string;
  readonly currentUrl: string;
  readonly frameCount: number;
  readonly hasLoginForm: boolean;
  readonly expected: boolean;
  readonly why: string;
}

const CASES: readonly IHomeNavCase[] = [
  {
    id: 'T-HOMENAV-1',
    currentUrl: HOMEPAGE_NORMALIZED,
    frameCount: 1,
    hasLoginForm: false,
    expected: false,
    why: 'never left the homepage — HOME must fail so the pulse can run',
  },
  {
    id: 'T-HOMENAV-2',
    currentUrl: HOMEPAGE_NORMALIZED,
    frameCount: 1,
    hasLoginForm: true,
    expected: true,
    why: 'login form visible — the gate searches every frame',
  },
  {
    id: 'T-HOMENAV-3',
    currentUrl: HOMEPAGE_NORMALIZED,
    frameCount: 2,
    hasLoginForm: false,
    expected: false,
    why: 'iframes alone prove nothing — every bank carries analytics frames',
  },
  {
    id: 'T-HOMENAV-4',
    currentUrl: 'https://www.bank.example/login',
    frameCount: 1,
    hasLoginForm: false,
    expected: true,
    why: 'genuinely navigated',
  },
  {
    id: 'T-HOMENAV-5',
    currentUrl: HOMEPAGE_NORMALIZED,
    frameCount: 0,
    hasLoginForm: false,
    expected: false,
    why: 'slash-only difference is not navigation',
  },
];

/**
 * Build a mediator that reports a fixed URL and a scripted form-gate result.
 * @param navCase - Scenario under test.
 * @returns Stub element mediator.
 */
function makeMediator(navCase: IHomeNavCase): IElementMediator {
  return {
    /**
     * Current page URL.
     * @returns The scenario's URL.
     */
    getCurrentUrl: (): string => navCase.currentUrl,
    /**
     * Form-gate visibility race.
     * @returns Found per the scenario.
     */
    resolveVisible: (): Promise<{ found: boolean }> => {
      const gate = { found: navCase.hasLoginForm };
      return Promise.resolve(gate);
    },
  } as unknown as IElementMediator;
}

/**
 * Build a pipeline context exposing the scenario's frame count.
 * @param navCase - Scenario under test.
 * @returns Context with an Option-shaped browser handle.
 */
function makeContext(navCase: IHomeNavCase): IPipelineContext {
  const frames = new Array<Frame>(navCase.frameCount);
  const page = {
    /**
     * Attached frames.
     * @returns Frame list of the scenario's length.
     */
    frames: (): Frame[] => frames,
  } as unknown as Page;
  return { browser: some({ page }) } as unknown as IPipelineContext;
}

describe('HOME POST login-area decision (T-HOMENAV)', () => {
  it.each(CASES)('$id: $why', async (navCase: IHomeNavCase) => {
    const mediator = makeMediator(navCase);
    const input = makeContext(navCase);
    const result = await executeValidateLoginArea({
      mediator,
      input,
      homepageUrl: HOMEPAGE,
      logger: SILENT,
    });
    const isAccepted = isOk(result);
    expect({ id: navCase.id, isAccepted }).toEqual({
      id: navCase.id,
      isAccepted: navCase.expected,
    });
  });
});
