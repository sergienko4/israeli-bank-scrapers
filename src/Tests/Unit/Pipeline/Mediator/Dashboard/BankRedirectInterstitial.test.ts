/**
 * Stage-isolation regression: live Isracard E2E run
 * `10-05-2026_01163762` failed at DASHBOARD.PRE because the bank
 * served `/StatusPage` (mobile-app push interstitial) instead of
 * the real dashboard. The only visible clickable text was
 * "לאפליקציה" ("to the app"). The pipeline emitted
 * `DASHBOARD PRE: no navigation target found` with the generic
 * `Generic` errorType — too coarse to distinguish a real DOM-
 * rendering failure from a known bank-redirect interstitial.
 *
 * <p>This test pins the pure detection helper that the PRE
 * fail-loud branch now consults to emit specific codes:
 * `DASHBOARD_BANK_REDIRECT` for known interstitials,
 * `DASHBOARD_NO_NAV_TARGET` otherwise.
 */

import type { Page } from 'playwright-core';

import {
  BANK_REDIRECT_TEXT_MARKERS,
  BANK_REDIRECT_URL_MARKERS,
  detectBankRedirectInterstitial,
  executePreLocateNav,
} from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../Scrapers/Pipeline/MockPipelineFactories.js';

describe('detectBankRedirectInterstitial', () => {
  it('returns true when the URL contains the /StatusPage marker (Isracard interstitial)', () => {
    const isRedirect = detectBankRedirectInterstitial('https://web.isracard.co.il/StatusPage', []);
    expect(isRedirect).toBe(true);
  });

  it('returns true when visible texts include the to-the-app marker (Isracard interstitial)', () => {
    const isRedirect = detectBankRedirectInterstitial(
      'https://web.isracard.co.il/Some/Other/Page',
      ['לאפליקציה', 'unrelated text'],
    );
    expect(isRedirect).toBe(true);
  });

  it('returns false when neither URL nor visible texts match a known marker', () => {
    const isRedirect = detectBankRedirectInterstitial('https://bank.example.com/AccountSummary', [
      'Recent Transactions',
      'Settings',
    ]);
    expect(isRedirect).toBe(false);
  });

  it('returns false on empty inputs', () => {
    const isRedirect = detectBankRedirectInterstitial('', []);
    expect(isRedirect).toBe(false);
  });

  it('exposes the markers as readonly arrays for traceability and external audit', () => {
    expect(BANK_REDIRECT_URL_MARKERS).toContain('/StatusPage');
    expect(BANK_REDIRECT_TEXT_MARKERS).toContain('לאפליקציה');
  });
});

/**
 * Build a Playwright page mock whose `$$eval` returns the supplied
 * visible texts. Mirrors the bank-redirect interstitial scenario:
 * minimal DOM with one CTA button.
 *
 * @param texts - The visible-clickable-text strings the dump helper
 *   should observe.
 * @returns Page mock returning {@link texts} from `$$eval`.
 */
function makePageWithVisibleTexts(texts: readonly string[]): Page {
  const base = makeMockFullPage();
  return {
    ...base,
    /**
     * Return the canned visible texts.
     *
     * @returns Resolved texts.
     */
    $$eval: (): Promise<readonly string[]> => Promise.resolve(texts),
  };
}

/**
 * Build a {@link IPipelineContext} pre-wired so DASHBOARD.PRE's
 * dashboard discovery returns no nav targets and the URL + visible
 * texts steer `detectBankRedirectInterstitial` to a deterministic
 * outcome.
 *
 * @param currentUrl - URL the mediator's `getCurrentUrl()` returns.
 * @param visibleTexts - Texts the page's `$$eval` returns.
 * @returns Wired context ready for `executePreLocateNav`.
 */
function makeNoTargetCtx(currentUrl: string, visibleTexts: readonly string[]): IPipelineContext {
  const page = makePageWithVisibleTexts(visibleTexts);
  const browserState = makeMockBrowserState(page);
  const overrides: Partial<IElementMediator> = {
    /**
     * Override the URL so the redirect detector observes the
     * test-controlled value.
     *
     * @returns Stable URL.
     */
    getCurrentUrl: (): string => currentUrl,
  };
  const mediator = makeMockMediator(overrides);
  return makeMockContext({
    browser: some(browserState),
    mediator: some(mediator),
  });
}

describe('executePreLocateNav — fail-loud distinction (stage-isolation regression)', () => {
  it('emits DASHBOARD_BANK_REDIRECT when URL matches a known interstitial marker', async () => {
    const ctx = makeNoTargetCtx('https://web.isracard.co.il/StatusPage', []);
    const result = await executePreLocateNav(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('DASHBOARD_BANK_REDIRECT');
    }
  });

  it('emits DASHBOARD_BANK_REDIRECT when visible texts contain the to-the-app marker', async () => {
    const ctx = makeNoTargetCtx('https://bank.example.com/somewhere', ['לאפליקציה']);
    const result = await executePreLocateNav(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('DASHBOARD_BANK_REDIRECT');
    }
  });

  it('emits DASHBOARD_NO_NAV_TARGET when neither URL nor texts match a marker', async () => {
    const ctx = makeNoTargetCtx('https://bank.example.com/AccountSummary', ['Settings']);
    const result = await executePreLocateNav(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('DASHBOARD_NO_NAV_TARGET');
    }
  });
});
