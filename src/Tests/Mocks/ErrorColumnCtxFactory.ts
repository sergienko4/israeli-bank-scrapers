/**
 * Shared mock factory for the Phase 12d ErrorDiscovery column-array
 * data contract.
 *
 * <p>Both `FormErrorDiscovery` unit suites (`Tests/Unit/Pipeline/
 * Infrastructure` + `Tests/Unit/Scrapers/Pipeline/Mediator`) drive
 * `discoverFormErrors` through a mock `ctx.evaluate` that dispatches on
 * the browser closure's `fn.name` and returns ONE pre-baked column.
 * Centralised here so the 4-column contract stays synchronised across
 * both suites instead of drifting in two hand-rolled copies
 * (CR PR #345 round-4 finding).
 */

import type { Page } from 'playwright-core';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { NO_CLASS } from '../../Scrapers/Pipeline/Mediator/Form/ErrorDiscovery/ErrorDiscoveryTypes.js';

/** Pre-baked DOM row mirroring the internal `IRawDomItem` of `discoverFormErrors`. */
export interface IErrorColumnItem {
  tag: string;
  cls: string;
  text: string;
  isHidden: boolean;
}

/**
 * Build a mock {@link Page} whose `evaluate` dispatches on the browser
 * closure's function name and returns ONE column extracted from the
 * pre-baked rows. Phase 12d split the single compound evaluate into 4
 * parallel single-column evaluates (column-array data contract); the
 * empty-class → `NO_CLASS` sentinel mirrors the real `getErrorClasses`
 * browser closure so the mock cannot drift from production.
 * @param items - Pre-baked DOM rows to derive each column from.
 * @returns Mock `Page` satisfying the 4-call column contract.
 */
export function makeErrorColumnCtx(items: readonly IErrorColumnItem[]): Page {
  return {
    /**
     * Dispatch on `fn.name` to return the matching column for `items`.
     * @param fn - Browser closure (one of get*Tags|Classes|Texts|Hidden).
     * @param fn.name - Closure function name used for dispatch.
     * @returns Resolved column array, typed as the closure's return.
     * @throws {ScraperError} When an unexpected closure name is dispatched.
     */
    evaluate: <T>(fn: { readonly name: string }): Promise<T> => {
      if (fn.name === 'getErrorTags') {
        return Promise.resolve(items.map((i): string => i.tag) as unknown as T);
      }
      if (fn.name === 'getErrorClasses') {
        return Promise.resolve(
          items.map((i): string => (i.cls.trim().length === 0 ? NO_CLASS : i.cls)) as unknown as T,
        );
      }
      if (fn.name === 'getErrorTexts') {
        return Promise.resolve(items.map((i): string => i.text) as unknown as T);
      }
      if (fn.name === 'getErrorHidden') {
        return Promise.resolve(items.map((i): boolean => i.isHidden) as unknown as T);
      }
      throw new ScraperError('makeErrorColumnCtx: unexpected closure name: ' + fn.name);
    },
  } as unknown as Page;
}
