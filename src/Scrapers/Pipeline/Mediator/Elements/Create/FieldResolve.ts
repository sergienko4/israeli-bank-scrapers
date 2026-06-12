/**
 * Field-resolution wrapping for IElementMediator — builds the
 * `resolveField` and `resolveClickable` methods that scrapers invoke
 * to map a fieldKey + WK candidates to a concrete IFieldContext.
 *
 * Public surface (consumed by the parent mediator's cluster
 * assembler, `buildResolveCluster`):
 *   - `IFormCache` — per-instance mutable cache for the form-anchor
 *     selector; threaded through every method that needs form scoping.
 *   - `buildResolveField` — wraps resolveFieldPipeline with scoped→wide
 *     fallback semantics and error catching.
 *   - `buildResolveClickable` — same wrapper but always with the
 *     `__submit__` fieldKey so WellKnown.__submit__ is the fallback.
 *
 * Private helpers (scope tryout, impl orchestrator, error converter)
 * stay encapsulated — no callers outside this cluster.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §7).
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import { fail, type Procedure, succeed } from '../../../Types/Procedure.js';
import { resolveFieldPipeline } from '../../Selector/PipelineFieldResolver.js';
import type { IFieldContext } from '../../Selector/SelectorResolverPipeline.js';
import type { IElementMediator } from '../ElementMediator.js';

/** Per-instance mutable cache for the form anchor selector. */
export interface IFormCache {
  selector: string;
}

/** Options for field resolution — bundled to satisfy max-params. */
interface IResolveOpts {
  readonly page: Page;
  readonly fieldKey: string;
  readonly candidates: readonly SelectorCandidate[];
  readonly scopeContext?: Page | Frame;
  readonly formSelector?: string;
}

/**
 * Try scoped resolve in the same iframe — flat, no nesting.
 * @param opts - Bundled resolution options.
 * @returns Resolved field context or null-ish if not found in scope.
 */
async function tryScopedResolve(opts: IResolveOpts): Promise<IFieldContext | false> {
  if (!opts.scopeContext) return false;
  const scoped = await resolveFieldPipeline({
    pageOrFrame: opts.scopeContext,
    fieldKey: opts.fieldKey,
    bankCandidates: opts.candidates,
    formSelector: opts.formSelector,
  });
  if (scoped.isResolved) return scoped;
  return false;
}

/**
 * Try scoped search first, then full page scan.
 * @param opts - Bundled resolution options.
 * @returns Success or failure Procedure.
 */
async function resolveFieldImpl(opts: IResolveOpts): Promise<Procedure<IFieldContext>> {
  const notFoundMsg = `Field not found: ${opts.fieldKey}`;
  const scopeHit = await tryScopedResolve(opts);
  if (scopeHit) return succeed<IFieldContext>(scopeHit);
  const wide = await resolveFieldPipeline({
    pageOrFrame: opts.page,
    fieldKey: opts.fieldKey,
    bankCandidates: opts.candidates,
  });
  if (wide.isResolved) return succeed<IFieldContext>(wide);
  return fail(ScraperErrorTypes.Generic, notFoundMsg);
}

/**
 * Catch resolution errors and return failure Procedure.
 * @param error - Thrown error.
 * @returns Failure Procedure.
 */
function handleResolveError(error: Error): Procedure<IFieldContext> {
  const msg = toErrorMessage(error);
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * Resolve a field by key — delegates to resolveFieldImpl.
 * @param opts - Bundled resolution options.
 * @returns Procedure with resolved field context.
 */
function resolveFieldForPage(opts: IResolveOpts): Promise<Procedure<IFieldContext>> {
  return resolveFieldImpl(opts).catch(handleResolveError);
}

/**
 * Build resolveField method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveField function.
 */
export function buildResolveField(page: Page): IElementMediator['resolveField'] {
  return (
    ...args: Parameters<IElementMediator['resolveField']>
  ): Promise<Procedure<IFieldContext>> => {
    const [fieldKey, candidates, scopeContext, formSelector] = args;
    const opts: IResolveOpts = { page, fieldKey, candidates, scopeContext, formSelector };
    return resolveFieldForPage(opts);
  };
}

/**
 * Build resolveClickable method bound to a page.
 * Uses '__submit__' as the fieldKey so WellKnown.__submit__ is the automatic fallback.
 * Searches main page + child iframes (via resolveFieldPipeline) — correct for iframe forms.
 * Returns IFieldContext so caller can click in the correct frame/page context.
 * @param page - The Playwright page.
 * @returns Mediator resolveClickable function.
 */
export function buildResolveClickable(page: Page): IElementMediator['resolveClickable'] {
  return (candidates): Promise<Procedure<IFieldContext>> => {
    const opts: IResolveOpts = { page, fieldKey: '__submit__', candidates };
    return resolveFieldImpl(opts).catch(handleResolveError);
  };
}
