/**
 * Unit tests for VisaCal login config, buildLocator, and pipeline builder.
 * Tests buildLocator branches, VISACAL_LOGIN callbacks, buildVisaCalPipeline shape.
 */

import type { Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import {
  buildLocator,
  buildVisaCalPipeline,
  VISACAL_LOGIN,
} from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../../Pipeline/Infrastructure/MockFactories.js';

/** Mock options for pipeline builder. */
const MOCK_OPTIONS = makeMockOptions({ companyId: 'visaCal' as never });

/** Sentinel locator returned by all mock getBy* methods. */
const SENTINEL_LOCATOR: Locator = {
  /**
   * Return self for chaining.
   * @returns This locator.
   */
  first: () => SENTINEL_LOCATOR,
  /**
   * WaitFor mock.
   * @returns Resolved.
   */
  waitFor: (): Promise<boolean> => Promise.resolve(true),
  /**
   * Click mock.
   * @returns Resolved.
   */
  click: (): Promise<boolean> => Promise.resolve(true),
} as unknown as Locator;

/** Track which getBy method was called. */
let lastCalledMethod = '';

/**
 * Create a mock page that tracks which getBy* method was called.
 * @returns Mock Page/Frame with getByLabel, getByPlaceholder, getByText.
 */
function makeMockLocatorPage(): Page {
  lastCalledMethod = '';
  return {
    /**
     * Mock getByLabel — records method call.
     * @returns Sentinel locator.
     */
    getByLabel: (): Locator => {
      lastCalledMethod = 'getByLabel';
      return SENTINEL_LOCATOR;
    },
    /**
     * Mock getByPlaceholder — records method call.
     * @returns Sentinel locator.
     */
    getByPlaceholder: (): Locator => {
      lastCalledMethod = 'getByPlaceholder';
      return SENTINEL_LOCATOR;
    },
    /**
     * Mock getByText — records method call.
     * @returns Sentinel locator.
     */
    getByText: (): Locator => {
      lastCalledMethod = 'getByText';
      return SENTINEL_LOCATOR;
    },
    /**
     * Mock waitForLoadState — resolves immediately.
     * @returns Resolved.
     */
    waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;
}

describe('buildLocator', () => {
  it.each([
    { kind: 'ariaLabel' as const, expected: 'getByLabel' },
    { kind: 'placeholder' as const, expected: 'getByPlaceholder' },
    { kind: 'textContent' as const, expected: 'getByText' },
    { kind: 'labelText' as const, expected: 'getByText' },
  ] as const)(
    /**
     * Verify $kind dispatches to $expected.
     * @param kind - SelectorCandidate kind.
     * @param expected - Expected method name.
     */
    'kind $kind dispatches to $expected',
    ({ kind, expected }) => {
      const page = makeMockLocatorPage();
      const candidate: SelectorCandidate = { kind, value: 'test' };
      buildLocator(page, candidate);
      expect(lastCalledMethod).toBe(expected);
    },
  );
});

describe('VISACAL_LOGIN', () => {
  describe('config shape', () => {
    it('has username and password fields', () => {
      expect(VISACAL_LOGIN.fields).toHaveLength(2);
      const keys = VISACAL_LOGIN.fields.map(f => f.credentialKey);
      expect(keys).toEqual(['username', 'password']);
    });

    it('has submit candidates', () => {
      const submit = Array.isArray(VISACAL_LOGIN.submit)
        ? VISACAL_LOGIN.submit
        : [VISACAL_LOGIN.submit];
      expect(submit.length).toBeGreaterThan(0);
    });
  });

  describe('checkReadiness', () => {
    it('resolves when any login link locator becomes visible', async () => {
      const page = makeMockLocatorPage();
      await VISACAL_LOGIN.checkReadiness?.(page);
      expect(lastCalledMethod).toBeTruthy();
    });
  });

  describe('postAction', () => {
    it('waits for networkidle', async () => {
      let capturedState = '';
      const page = {
        /**
         * Mock waitForLoadState — captures state arg.
         * @param state - Load state to wait for.
         * @returns Resolved.
         */
        waitForLoadState: (state: string): Promise<boolean> => {
          capturedState = state;
          return Promise.resolve(true);
        },
      } as unknown as Page;
      await VISACAL_LOGIN.postAction?.(page);
      expect(capturedState).toBe('networkidle');
    });
  });
});

describe('buildVisaCalPipeline', () => {
  it('returns descriptor with 4 phases', () => {
    const result = buildVisaCalPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    expect(descriptor.phases).toHaveLength(4);
  });

  it('phase names are init, login, scrape, terminate', () => {
    const result = buildVisaCalPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    const names = descriptor.phases.map(p => p.name);
    expect(names).toEqual(['init', 'login', 'scrape', 'terminate']);
  });
});
