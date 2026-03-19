/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor.
 * Black box for HTML resolution — scrapers describe WHAT, mediator finds HOW.
 * Each mediator instance has its own form anchor cache (no shared mutable state).
 */

import type { Page } from 'playwright-core';

import { getDebug } from '../../../Common/Debug.js';
import { discoverFormAnchor, scopeCandidates } from '../../../Common/FormAnchor.js';
import { tryInContext } from '../../../Common/SelectorResolver.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { none, some } from '../Types/Option.js';
import { fail, succeed } from '../Types/Procedure.js';
import type { IElementMediator } from './ElementMediator.js';
import { resolveFieldPipeline } from './PipelineFieldResolver.js';

const LOG = getDebug('element-mediator');

/** Per-instance mutable cache for the form anchor selector. */
interface IFormCache {
  selector: string;
}

/**
 * Build resolveField method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveField function.
 */
function buildResolveField(page: Page): IElementMediator['resolveField'] {
  return async (fieldKey, candidates) => {
    try {
      const ctx = await resolveFieldPipeline(page, fieldKey, candidates);
      if (ctx.isResolved) return succeed<IFieldContext>(ctx);
      const msg = `Field not found: ${fieldKey} on ${page.url()}`;
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
 * Build discoverForm method with per-instance cache.
 * @param page - The Playwright page.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator discoverForm function.
 */
function buildDiscoverForm(page: Page, cache: IFormCache): IElementMediator['discoverForm'] {
  return async (resolvedContext: IFieldContext) => {
    try {
      const anchor = await discoverFormAnchor(page, resolvedContext.selector);
      if (anchor) {
        cache.selector = anchor.selector;
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
 * Build scopeToForm method with per-instance cache.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator scopeToForm function.
 */
function buildScopeToForm(cache: IFormCache): IElementMediator['scopeToForm'] {
  return (candidates: readonly SelectorCandidate[]) => {
    if (!cache.selector) return candidates;
    const mutable = [...candidates];
    return scopeCandidates(cache.selector, mutable);
  };
}

/**
 * Create an ElementMediator for the given page.
 * Each instance has its own form anchor cache — safe for concurrent use.
 * @param page - The Playwright page to resolve elements on.
 * @returns An IElementMediator with real implementations.
 */
function createElementMediator(page: Page): IElementMediator {
  const cache: IFormCache = { selector: '' };
  return {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    discoverForm: buildDiscoverForm(page, cache),
    scopeToForm: buildScopeToForm(cache),
  };
}

export default createElementMediator;
export { createElementMediator };
