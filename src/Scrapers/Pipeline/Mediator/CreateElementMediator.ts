/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor.
 * Stub: all methods return fail('NOT_IMPLEMENTED') until Step 3.
 */

import type { Page } from 'playwright-core';

import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { none } from '../Types/Option.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail } from '../Types/Procedure.js';
import type { IElementMediator } from './ElementMediator.js';

const STUB_PREFIX = 'ElementMediator stub';

/**
 * Build a stub "not implemented" message with context.
 * @param method - The method name.
 * @param detail - Additional context info.
 * @returns Formatted stub message.
 */
function stubMessage(method: string, detail: string): string {
  return `${STUB_PREFIX}: ${method}(${detail})`;
}

/**
 * Stub: resolve a field (not implemented).
 * @param pageUrl - URL of the page for diagnostics.
 * @param fieldKey - Credential key to resolve.
 * @param candidates - Selector candidates.
 * @returns Failure Procedure.
 */
function stubResolveField(
  pageUrl: string,
  fieldKey: string,
  candidates: readonly SelectorCandidate[],
): Promise<Procedure<IFieldContext>> {
  const count = String(candidates.length);
  const msg = stubMessage('resolveField', `${fieldKey}, ${count} candidates, ${pageUrl}`);
  const result = fail(ScraperErrorTypes.Generic, msg);
  return Promise.resolve(result);
}

/**
 * Stub: resolve a clickable element (not implemented).
 * @param pageUrl - URL of the page for diagnostics.
 * @param candidates - Selector candidates.
 * @returns Failure Procedure.
 */
function stubResolveClickable(
  pageUrl: string,
  candidates: readonly SelectorCandidate[],
): Promise<Procedure<string>> {
  const count = String(candidates.length);
  const msg = stubMessage('resolveClickable', `${count} candidates, ${pageUrl}`);
  const result = fail(ScraperErrorTypes.Generic, msg);
  return Promise.resolve(result);
}

/**
 * Stub: scope candidates to form (passthrough).
 * @param candidates - Candidates to scope.
 * @returns The same candidates unchanged.
 */
function stubScopeToForm(candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[] {
  return candidates;
}

/**
 * Build a discoverForm stub bound to a page.
 * @param page - The Playwright page for live URL reads.
 * @returns A discoverForm function that always returns none().
 */
function buildDiscoverForm(page: Page): IElementMediator['discoverForm'] {
  return (resolvedContext: IFieldContext) => {
    const url = page.url();
    stubMessage('discoverForm', `${resolvedContext.selector}, ${url}`);
    const result = none();
    return Promise.resolve(result);
  };
}

/**
 * Build a resolveField stub bound to a page.
 * @param page - The Playwright page for live URL reads.
 * @returns A resolveField function.
 */
function buildResolveField(page: Page): IElementMediator['resolveField'] {
  return (fk, c) => {
    const url = page.url();
    return stubResolveField(url, fk, c);
  };
}

/**
 * Build a resolveClickable stub bound to a page.
 * @param page - The Playwright page for live URL reads.
 * @returns A resolveClickable function.
 */
function buildResolveClickable(page: Page): IElementMediator['resolveClickable'] {
  return c => {
    const url = page.url();
    return stubResolveClickable(url, c);
  };
}

/**
 * Create an ElementMediator for the given page (stub).
 * Uses page.url() at call time, not factory time.
 * @param page - The Playwright page to resolve elements on.
 * @returns An IElementMediator with stub implementations.
 */
function createElementMediator(page: Page): IElementMediator {
  return {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    discoverForm: buildDiscoverForm(page),
    scopeToForm: stubScopeToForm,
  };
}

export default createElementMediator;
export { createElementMediator };
