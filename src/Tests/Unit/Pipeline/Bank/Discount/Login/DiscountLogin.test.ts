/**
 * Unit tests for Discount login config and pipeline builder.
 * Tests DISCOUNT_LOGIN callbacks and buildDiscountPipeline shape.
 */

import type { Page } from 'playwright-core';

import { CompanyTypes } from '../../../../../../Definitions.js';
import {
  buildDiscountPipeline,
  DISCOUNT_LOGIN,
} from '../../../../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../../Pipeline/Infrastructure/MockFactories.js';

/** Mock options for pipeline builder. */
const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.Discount });

/** Captured goto URL from mock page. */
let capturedGotoUrl = '';

/** Captured waitForURL pattern from mock page. */
let capturedWaitPattern = '';

/** Whether getByRole was called with 'textbox'. */
let wasGetByRoleCalled = false;

/** Whether waitFor was called. */
let wasWaitForCalled = false;

/**
 * Create a mock page for Discount login callback tests.
 * Captures call arguments via closures instead of jest.fn spies.
 * @returns Mock Page with goto, getByRole, waitForURL.
 */
function makeMockDiscountPage(): Page {
  capturedGotoUrl = '';
  capturedWaitPattern = '';
  wasGetByRoleCalled = false;
  wasWaitForCalled = false;
  return {
    /**
     * Navigate mock — captures URL.
     * @param url - Navigation target.
     * @returns Resolved true.
     */
    goto: (url: string): Promise<boolean> => {
      capturedGotoUrl = url;
      return Promise.resolve(true);
    },
    /**
     * Return a mock role locator.
     * @param role - ARIA role to find.
     * @returns Object with first() returning waitFor.
     */
    getByRole: (role: string) => {
      wasGetByRoleCalled = role === 'textbox';
      return {
        /**
         * Return first element mock with waitFor.
         * @returns Object with waitFor callback.
         */
        first: () => ({
          /**
           * WaitFor mock — marks as called.
           * @returns Resolved true.
           */
          waitFor: (): Promise<boolean> => {
            wasWaitForCalled = true;
            return Promise.resolve(true);
          },
        }),
      };
    },
    /**
     * Wait for URL mock — captures pattern.
     * @param pattern - URL pattern to wait for.
     * @returns Resolved true.
     */
    waitForURL: (pattern: string): Promise<boolean> => {
      capturedWaitPattern = pattern;
      return Promise.resolve(true);
    },
  } as unknown as Page;
}

describe('DISCOUNT_LOGIN', () => {
  describe('config shape', () => {
    it('has three credential fields: id, password, num', () => {
      expect(DISCOUNT_LOGIN.fields).toHaveLength(3);
      const keys = DISCOUNT_LOGIN.fields.map(f => f.credentialKey);
      expect(keys).toEqual(['id', 'password', 'num']);
    });

    it('has submit candidates', () => {
      const submit = Array.isArray(DISCOUNT_LOGIN.submit)
        ? DISCOUNT_LOGIN.submit
        : [DISCOUNT_LOGIN.submit];
      expect(submit.length).toBeGreaterThan(0);
    });

    it('has possibleResults with success URLs', () => {
      const results = DISCOUNT_LOGIN.possibleResults;
      expect(results.success.length).toBeGreaterThan(0);
    });
  });

  describe('checkReadiness', () => {
    it('navigates to login portal and waits for textbox', async () => {
      const page = makeMockDiscountPage();
      await DISCOUNT_LOGIN.checkReadiness?.(page);
      expect(capturedGotoUrl).toContain('telebank.co.il/login');
      expect(wasGetByRoleCalled).toBe(true);
      expect(wasWaitForCalled).toBe(true);
    });
  });

  describe('postAction', () => {
    it('waits for apollo URL redirect', async () => {
      const page = makeMockDiscountPage();
      await DISCOUNT_LOGIN.postAction?.(page);
      expect(capturedWaitPattern).toContain('apollo');
    });
  });
});

describe('buildDiscountPipeline', () => {
  it('returns descriptor with 4 phases', () => {
    const result = buildDiscountPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    expect(descriptor.phases).toHaveLength(4);
  });

  it('phase names are init, login, scrape, terminate', () => {
    const result = buildDiscountPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    const names = descriptor.phases.map(p => p.name);
    expect(names).toEqual(['init', 'login', 'scrape', 'terminate']);
  });
});
