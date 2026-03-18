/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor.
 * Black box for HTML resolution — scrapers describe WHAT, mediator finds HOW.
 */

import type { Page } from 'playwright-core';

import { getDebug } from '../../../Common/Debug.js';
import { discoverFormAnchor, scopeCandidates } from '../../../Common/FormAnchor.js';
import { resolveFieldContext, tryInContext } from '../../../Common/SelectorResolver.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { none, some } from '../Types/Option.js';
import { fail, succeed } from '../Types/Procedure.js';
import type { IElementMediator } from './ElementMediator.js';

const LOG = getDebug('element-mediator');

/** Cached form selector — shared across calls within one mediator. */
let cachedFormSelector = '';

/**
 * Build resolveField method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveField function.
 */
function buildResolveField(page: Page): IElementMediator['resolveField'] {
  return async (fieldKey, candidates) => {
    const pageUrl = page.url();
    const field = { credentialKey: fieldKey, selectors: [...candidates] };
    try {
      const ctx = await resolveFieldContext(page, field, pageUrl);
      if (ctx.isResolved) return succeed(ctx);
      const msg = `Field not found: ${fieldKey} on ${pageUrl}`;
      return fail(ScraperErrorTypes.Generic, msg);
    } catch (error) {
      const msg = (error as Error).message;
      return fail(ScraperErrorTypes.Generic, msg);
    }
  };
}

/**
 * Build resolveClickable method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveClickable function.
 */
function buildResolveClickable(page: Page): IElementMediator['resolveClickable'] {
  return async candidates => {
    try {
      const mutableCandidates = [...candidates];
      const css = await tryInContext(page, mutableCandidates);
      if (css) return succeed(css);
      return fail(ScraperErrorTypes.Generic, 'Clickable not found');
    } catch (error) {
      const msg = (error as Error).message;
      return fail(ScraperErrorTypes.Generic, msg);
    }
  };
}

/**
 * Build discoverForm method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator discoverForm function.
 */
function buildDiscoverForm(page: Page): IElementMediator['discoverForm'] {
  return async (resolvedContext: IFieldContext) => {
    try {
      const anchor = await discoverFormAnchor(page, resolvedContext.selector);
      if (anchor) {
        cachedFormSelector = anchor.selector;
        return some(anchor);
      }
      return none();
    } catch (error) {
      const msg = (error as Error).message.slice(0, 60);
      LOG.debug('discoverForm failed (non-fatal): %s', msg);
      return none();
    }
  };
}

/**
 * Scope candidates to the cached form anchor.
 * @param candidates - Candidates to scope.
 * @returns Scoped candidates (or original if no form cached).
 */
function scopeToForm(candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[] {
  if (!cachedFormSelector) return candidates;
  const mutable = [...candidates];
  return scopeCandidates(cachedFormSelector, mutable);
}

/**
 * Create an ElementMediator for the given page.
 * Delegates to SelectorResolver + FormAnchor.
 * @param page - The Playwright page to resolve elements on.
 * @returns An IElementMediator with real implementations.
 */
function createElementMediator(page: Page): IElementMediator {
  cachedFormSelector = '';
  return {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    discoverForm: buildDiscoverForm(page),
    scopeToForm,
  };
}

export default createElementMediator;
export { createElementMediator };
