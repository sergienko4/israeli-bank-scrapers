/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor.
 * Stub: all methods return fail('NOT_IMPLEMENTED') until Step 3.
 */

import type { Page } from 'playwright-core';

import type { IFormAnchor } from '../../../Common/FormAnchor.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { Option } from '../Types/Option.js';
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
 * Stub: discover form anchor (not implemented).
 * @param resolvedContext - The resolved field context.
 * @returns None option (no form discovered).
 */
function stubDiscoverForm(resolvedContext: IFieldContext): Promise<Option<IFormAnchor>> {
  const selector = resolvedContext.selector;
  stubMessage('discoverForm', selector);
  const result = none();
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
 * Create an ElementMediator for the given page (stub).
 * @param page - The Playwright page to resolve elements on.
 * @returns An IElementMediator with stub implementations.
 */
function createElementMediator(page: Page): IElementMediator {
  const pageUrl = page.url();
  return {
    /** @inheritdoc */
    resolveField: (fk, c) => stubResolveField(pageUrl, fk, c),
    /** @inheritdoc */
    resolveClickable: c => stubResolveClickable(pageUrl, c),
    discoverForm: stubDiscoverForm,
    scopeToForm: stubScopeToForm,
  };
}

export default createElementMediator;
export { createElementMediator };
