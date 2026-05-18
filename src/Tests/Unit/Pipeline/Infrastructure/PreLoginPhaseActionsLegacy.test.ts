/**
 * Unit tests for PreLoginPhaseActions — legacy + deep paths split from main file.
 */

import {
  executeFireRevealClicks,
  executeFireRevealClicksSealed,
  executePreLocateReveal,
} from '../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
import type { ContextId } from '../../../../Scrapers/Pipeline/Types/Brand.js';
import type { ISome, Option } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPreLoginDiscovery,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import {
  makeMockActionExecutor as makeExec,
  makeScreenshotPage,
  toActionCtx,
} from './TestHelpers.js';

/** Test-local error. */
class AssertBrowserStateError extends Error {
  /**
   * Construct with fixed message.
   */
  constructor() {
    super('factory postcondition: browser some');
    this.name = 'AssertBrowserStateError';
  }
}

/**
 * Narrow a factory-returned browser Option to its Some form.
 * @param browser - Option.
 * @returns The same Option, typed as ISome.
 */
function assertSomeBrowser(browser: Option<IBrowserState>): ISome<IBrowserState> {
  if (!browser.has) throw new AssertBrowserStateError();
  return browser;
}

/** Mock reveal target. */
const MOCK_TARGET: IResolvedTarget = {
  selector: 'button',
  contextId: 'main' as ContextId,
  kind: 'textContent',
  candidateValue: 'Enter',
};

describe('executeFireRevealClicks (legacy)', () => {
  it('runs legacy path — private customers + credential area', async () => {
    const mediator = makeMockMediator();
    const makeScreenshotPageResult27 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult27);
    const page = assertSomeBrowser(base.browser).value.page;
    const result = await executeFireRevealClicks(mediator, page, base);
    const isOkResult28 = isOk(result);
    expect(isOkResult28).toBe(true);
  });
});

// ── executePreLocateReveal reveal-target-found path ─────────────────
describe('executePreLocateReveal — reveal target resolved', () => {
  it('resolves reveal target when probeRevealStatus finds READY', async () => {
    const { NOT_FOUND_RESULT: notFoundResult } =
      await import('../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js');
    const makeScreenshotPageResult29 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult29);
    const page = assertSomeBrowser(base.browser).value.page;
    const mediator = makeMockMediator({
      /**
       * All probes find target — reveal-first flow proceeds straight to resolve.
       * @returns Race.
       */
      resolveVisible: () => {
        const race = {
          ...notFoundResult,
          found: true as const,
          candidate: { kind: 'textContent' as const, value: 'Private' },
          context: page,
          value: 'Private',
        };
        return Promise.resolve(race);
      },
      /**
       * URL getter.
       * @returns URL.
       */
      getCurrentUrl: () => 'https://bank.example.com/home',
    });
    const result = await executePreLocateReveal(mediator, base);
    const isOkResult30 = isOk(result);
    expect(isOkResult30).toBe(true);
  });
});

// ── executeFireRevealClicksSealed NAVIGATE with executor ────────────
describe('executeFireRevealClicksSealed — NAVIGATE with executor', () => {
  it('navigates when NAVIGATE + target + executor all present', async () => {
    let wasNavigated = false;
    const exec = makeExec({
      /**
       * Track navigation.
       * @returns Resolved.
       */
      navigateTo: () => {
        wasNavigated = true;
        const okNav: { success: true; value: undefined } = { success: true, value: undefined };
        return Promise.resolve(okNav);
      },
    });
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'NOT_FOUND',
      credentialArea: 'NOT_FOUND',
      revealAction: 'NAVIGATE',
      revealTarget: { ...MOCK_TARGET, selector: 'https://bank.example.com/login' },
    };
    const makeScreenshotPageResult31 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult31);
    const withDisc = { ...base, preLoginDiscovery: some(disc) };
    const ctx = toActionCtx(withDisc, exec);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult32 = isOk(result);
    expect(isOkResult32).toBe(true);
    expect(wasNavigated).toBe(true);
  });
});
