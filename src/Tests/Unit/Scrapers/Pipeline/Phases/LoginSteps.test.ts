/**
 * Unit tests for LoginSteps.ts — checkFrameForErrors, waitForSubmitToSettle, preLogin.
 * loginAction and postLogin tests are in LoginStepsActions.test.ts.
 */

import type { Frame, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { checkFrameForErrors } from '../../../../../Scrapers/Pipeline/Mediator/FormErrorDiscovery.js';
import {
  createLoginPhase,
  waitForSubmitToSettle,
} from '../../../../../Scrapers/Pipeline/Phases/LoginSteps.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockFullPage,
} from '../MockPipelineFactories.js';

// ── Helper factories ───────────────────────────────────────

/**
 * Create a minimal ILoginConfig stub.
 * @param overrides - Optional field overrides.
 * @returns Minimal ILoginConfig.
 */
const MAKE_LOGIN_CONFIG = (overrides: Partial<ILoginConfig> = {}): ILoginConfig =>
  ({
    loginUrl: 'https://bank.test/login',
    fields: [],
    submit: [{ kind: 'textContent', value: 'כניסה' }],
    possibleResults: {},
    ...overrides,
  }) as unknown as ILoginConfig;

/**
 * Build a mock page whose getByText visibility depends on visibleTexts.
 * @param visibleTexts - Texts that appear visible.
 * @returns Mock page for Layer 2 error checks.
 */
const MAKE_FRAME_WITH_TEXTS = (visibleTexts: readonly string[]): Page =>
  ({
    /**
     * Return locator whose isVisible depends on visibleTexts.
     * @param text - Text to check.
     * @returns Locator with first().isVisible().
     */
    getByText: (text: string) => ({
      /**
       * Return first-element locator.
       * @returns First locator with isVisible.
       */
      first: () => ({
        /**
         * Return true if text is in visibleTexts.
         * @returns Promise<boolean>.
         */
        isVisible: (): Promise<boolean> => {
          const isFound = visibleTexts.includes(text);
          return Promise.resolve(isFound);
        },
      }),
    }),
  }) as unknown as Page;

/**
 * Build a detached frame mock that throws on isVisible.
 * @returns Mock Page that throws.
 */
const MAKE_DETACHED_FRAME = (): Page =>
  ({
    /**
     * Return locator that throws on isVisible.
     * @returns Throwing locator.
     */
    getByText: () => ({
      /**
       * Return first locator that throws.
       * @returns Throwing first locator.
       */
      first: () => ({
        /**
         * Always throws (detached frame).
         * @returns Rejected promise.
         */
        isVisible: (): Promise<boolean> => Promise.reject(new Error('Frame detached')),
      }),
    }),
  }) as unknown as Page;

/**
 * Build a page mock for waitForSubmitToSettle tests.
 * @param throws - Whether waitForLoadState should throw.
 * @returns Mock page.
 */
const MAKE_SETTLE_PAGE = (throws = false): Page =>
  ({
    /**
     * Mock waitForLoadState.
     * @returns Resolved or rejected promise.
     */
    waitForLoadState: (): Promise<boolean> =>
      throws ? Promise.reject(new Error('timeout')) : Promise.resolve(true),
  }) as unknown as Page;

// ── checkFrameForErrors (Layer 2) ─────────────────────────

describe('checkFrameForErrors', () => {
  it('returns hasErrors=false when no WellKnown text visible', async () => {
    const frame = MAKE_FRAME_WITH_TEXTS([]);
    const result = await checkFrameForErrors(frame);
    expect(result.hasErrors).toBe(false);
    expect(result.summary).toBe('');
  });

  it('returns hasErrors=true for Discount "פרטים שגויים"', async () => {
    const frame = MAKE_FRAME_WITH_TEXTS(['פרטים שגויים']);
    const result = await checkFrameForErrors(frame);
    expect(result.hasErrors).toBe(true);
    expect(result.summary).toBe('פרטים שגויים');
  });

  it('returns hasErrors=true for VisaCal error text', async () => {
    const visaCalErr = 'שם המשתמש או הסיסמה שהוזנו שגויים';
    const frame = MAKE_FRAME_WITH_TEXTS([visaCalErr]);
    const result = await checkFrameForErrors(frame);
    expect(result.hasErrors).toBe(true);
    expect(result.summary).toBe(visaCalErr);
  });

  it('returns hasErrors=false when frame is detached', async () => {
    const frame = MAKE_DETACHED_FRAME();
    const result = await checkFrameForErrors(frame);
    expect(result.hasErrors).toBe(false);
  });

  it('stops at first matching error text', async () => {
    const frame = MAKE_FRAME_WITH_TEXTS(['פרטים שגויים', 'שגיאה']);
    const result = await checkFrameForErrors(frame);
    expect(result.summary).toBe('פרטים שגויים');
  });
});

// ── waitForSubmitToSettle ─────────────────────────────────

describe('waitForSubmitToSettle', () => {
  it('resolves true when page reaches networkidle', async () => {
    const page = MAKE_SETTLE_PAGE(false);
    const isSettled = await waitForSubmitToSettle(page);
    expect(isSettled).toBe(true);
  });

  it('resolves true even when networkidle times out', async () => {
    const page = MAKE_SETTLE_PAGE(true);
    const isSettled = await waitForSubmitToSettle(page);
    expect(isSettled).toBe(true);
  });
});

// ── preLogin ──────────────────────────────────────────────

describe('LoginSteps/preLogin', () => {
  it('fails when browser is none()', async () => {
    const ctx = makeMockContext();
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.pre.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('No browser');
  });

  it('sets page as activeFrame (HOME already navigated)', async () => {
    const page = makeMockFullPage();
    const ctx = makeContextWithBrowser(page);
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.pre.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success && result.value.login.has) {
      expect(result.value.login.value.activeFrame).toBeTruthy();
    }
  });

  it('does NOT navigate (HOME handles navigation)', async () => {
    const page = makeMockFullPage();
    const gotoCalls: string[] = [];
    /**
     * Track goto calls — should NOT be called.
     * @param url - Navigation target.
     * @returns Resolved true.
     */
    const mockGoto = (url: string): Promise<boolean> => {
      gotoCalls.push(url);
      return Promise.resolve(true);
    };
    (page as unknown as { goto: (url: string) => Promise<boolean> }).goto = mockGoto;
    const ctx = makeContextWithBrowser(page);
    const config = MAKE_LOGIN_CONFIG({ loginUrl: 'https://test.bank/login' });
    const phase = createLoginPhase(config);
    await phase.pre.execute(ctx, ctx);
    expect(gotoCalls.length).toBe(0);
  });

  it('uses page as activeFrame when preAction returns undefined', async () => {
    const page = makeMockFullPage();
    const ctx = makeContextWithBrowser(page);
    const config = MAKE_LOGIN_CONFIG({
      /**
       * Mock preAction — returns undefined.
       * @returns Undefined frame.
       */
      preAction: (): Promise<Frame | undefined> => Promise.resolve(undefined),
    });
    const phase = createLoginPhase(config);
    const result = await phase.pre.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success && result.value.login.has) {
      expect(result.value.login.value.activeFrame).toBe(page);
    }
  });

  it('uses page as activeFrame when preAction is absent', async () => {
    const page = makeMockFullPage();
    const ctx = makeContextWithBrowser(page);
    const config = MAKE_LOGIN_CONFIG({ preAction: undefined });
    const phase = createLoginPhase(config);
    const result = await phase.pre.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success && result.value.login.has) {
      expect(result.value.login.value.activeFrame).toBe(page);
    }
  });

  it('sets login.activeFrame in context on success', async () => {
    const page = makeMockFullPage();
    const ctx = makeContextWithBrowser(page);
    const config = MAKE_LOGIN_CONFIG();
    const phase = createLoginPhase(config);
    const result = await phase.pre.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.login.has).toBe(true);
  });
});
