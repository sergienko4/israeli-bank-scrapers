/**
 * Branch recovery #3 for PreLoginPhaseActions.
 * Covers: executeFireRevealClicks (legacy) — branches at L220/L221/L229 —
 * when disc is present and privateCustomers / credentialArea are not 'NOT_FOUND'.
 */

import type { Page } from 'playwright-core';

import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeFireRevealClicks,
  executeSignalToLogin,
  executeValidateForm,
} from '../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPreLoginDiscovery } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage, requireBrowser } from './TestHelpers.js';

/**
 * Build a minimal found-style race result.
 * @returns A found race result pointing at a textContent candidate.
 */
function makeFoundResult(): IRaceResult {
  return {
    ...NOT_FOUND_RESULT,
    found: true as const,
    candidate: { kind: 'textContent', value: 'Reveal' },
    context: null as unknown as Page,
    value: 'Reveal',
  } as unknown as IRaceResult;
}

describe('PreLoginPhaseActions — branch recovery #3', () => {
  it('executeFireRevealClicks: privateCustomers READY — L221 true branch', async () => {
    // L221 (disc && priv !== NOT_FOUND) hits TRUE.
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'READY',
      credentialArea: 'NOT_FOUND',
      revealAction: 'CLICK',
    };
    let visibleCalls = 0;
    const mediator = makeMockMediator({
      /**
       * Alternating visibility probe.
       * @returns First call → found, then NOT_FOUND.
       */
      resolveVisible: (): Promise<IRaceResult> => {
        visibleCalls += 1;
        if (visibleCalls === 1) {
          const found = makeFoundResult();
          return Promise.resolve(found);
        }
        return Promise.resolve(NOT_FOUND_RESULT);
      },
      /**
       * URL getter.
       * @returns URL string.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/home',
    });
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    const ctx = { ...base, preLoginDiscovery: some(disc) };
    const browserState = requireBrowser(ctx);
    const result = await executeFireRevealClicks(mediator, browserState.page, ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('executeFireRevealClicks: credentialArea READY — L229 true branch', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'NOT_FOUND',
      credentialArea: 'READY',
      revealAction: 'CLICK',
    };
    const mediator = makeMockMediator({
      /**
       * Always return NOT_FOUND race (no match).
       * @returns NOT_FOUND_RESULT.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(NOT_FOUND_RESULT),
      /**
       * URL getter.
       * @returns URL string.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/home',
    });
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    const ctx = { ...base, preLoginDiscovery: some(disc) };
    const browserState = requireBrowser(ctx);
    const result = await executeFireRevealClicks(mediator, browserState.page, ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('executeValidateForm: no password found → fails at L250', async () => {
    const mediator = makeMockMediator({
      /**
       * Never find password — forces POST to fail.
       * @returns NOT_FOUND_RESULT.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.resolve(NOT_FOUND_RESULT),
      /**
       * URL getter.
       * @returns URL string.
       */
      getCurrentUrl: (): string => 'https://bank.example.com',
    });
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeValidateForm(mediator, ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
  });

  it('executeSignalToLogin: loginAreaReady=false → fail path at L267', () => {
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    const ctx = { ...base, loginAreaReady: false };
    const result = executeSignalToLogin(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
  });

  it('executeSignalToLogin: loginAreaReady=true → succeed path', () => {
    const page = makeScreenshotPage();
    const base = makeContextWithBrowser(page);
    const ctx = { ...base, loginAreaReady: true };
    const result = executeSignalToLogin(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });
});
