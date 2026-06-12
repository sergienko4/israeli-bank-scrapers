/**
 * Form/error discovery wrapping for IElementMediator — builds the
 * `discoverErrors`, `discoverForm`, and `scopeToForm` methods that
 * scrapers invoke after field resolution to (1) surface bank
 * validation errors, (2) detect the form anchor, and (3) re-scope
 * subsequent candidates to descendants of that anchor.
 *
 * Public surface (consumed by the parent mediator's cluster
 * assemblers, `buildFormCluster` and `buildResolveCluster`):
 *   - `buildDiscoverErrors` — wraps the Layer-1 DOM scan +
 *     Layer-2 WellKnown text fallback into one mediator method.
 *   - `buildDiscoverForm` — caches the discovered form anchor so
 *     subsequent calls in the same mediator instance can reuse it.
 *   - `buildScopeToForm` — uses the cached anchor to re-scope a
 *     candidate list (no-op when the cache is empty).
 *
 * Private helpers (form-discovery core + error catch) stay
 * encapsulated — no callers outside this cluster.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §7).
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { getDebug } from '../../../Types/Debug.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import { none, type Option, some } from '../../../Types/Option.js';
import { discoverFormAnchor, type IFormAnchor, scopeCandidates } from '../../Form/FormAnchor.js';
import {
  checkFrameForErrors,
  discoverFormErrors,
  type IFormErrorScanResult,
} from '../../Form/FormErrorDiscovery.js';
import type { IFieldContext } from '../../Selector/SelectorResolverPipeline.js';
import type { IElementMediator } from '../ElementMediator.js';
import type { IFormCache } from './FieldResolve.js';

const LOG = getDebug(import.meta.url);

/**
 * Build discoverErrors method.
 * Runs Layer 1 (DOM structural scan) then Layer 2 (WellKnown text) if needed.
 * The frame parameter lets callers target the specific context (e.g., connect iframe).
 * @returns Mediator discoverErrors function.
 */
export function buildDiscoverErrors(): IElementMediator['discoverErrors'] {
  return async (frame: Page | Frame): Promise<IFormErrorScanResult> => {
    const layer1 = await discoverFormErrors(frame);
    if (layer1.hasErrors) return layer1;
    return checkFrameForErrors(frame);
  };
}

/**
 * Discover form anchor and update cache — no try/catch (caller handles).
 * @param cache - Form cache to update.
 * @param resolvedContext - Resolved field context.
 * @returns Option with form anchor.
 */
async function discoverFormCore(
  cache: IFormCache,
  resolvedContext: IFieldContext,
): Promise<Option<IFormAnchor>> {
  const ctx = resolvedContext.context;
  const anchor = await discoverFormAnchor(ctx, resolvedContext.selector);
  if (!anchor) return none();
  cache.selector = anchor.selector;
  return some(anchor);
}

/**
 * Catch form discovery errors — non-fatal, returns none.
 * @param error - Thrown error.
 * @returns None option.
 */
function handleDiscoverFormError(error: Error): Option<IFormAnchor> {
  const truncated = toErrorMessage(error).slice(0, 60);
  LOG.debug({ message: `discoverForm failed (non-fatal): ${truncated}` });
  return none();
}

/**
 * Build discoverForm method with per-instance cache.
 * Uses resolvedContext.context (not root page) so iframe form anchors are found correctly.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator discoverForm function.
 */
export function buildDiscoverForm(cache: IFormCache): IElementMediator['discoverForm'] {
  return (resolvedContext: IFieldContext): Promise<Option<IFormAnchor>> =>
    discoverFormCore(cache, resolvedContext).catch(handleDiscoverFormError);
}

/**
 * Build scopeToForm method with per-instance cache.
 * @param cache - Mutable form cache owned by this mediator instance.
 * @returns Mediator scopeToForm function.
 */
export function buildScopeToForm(cache: IFormCache): IElementMediator['scopeToForm'] {
  return (candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[] => {
    if (!cache.selector) return candidates;
    const mutable = [...candidates];
    return scopeCandidates(cache.selector, mutable);
  };
}
