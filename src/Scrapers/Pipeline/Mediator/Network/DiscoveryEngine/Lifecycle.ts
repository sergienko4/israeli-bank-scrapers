/**
 * DiscoveryEngine / Lifecycle — the deferred-/eager-attach state
 * machine that owns the Playwright `response` listener and the
 * cross-frame POST/PUT interceptor. Extracted from
 * `DiscoveryEngine.ts` per PR #276 review-fix so the composer fits
 * the Section 11 150 eff-LoC file cap.
 */

import type { Page, Response } from 'playwright-core';

import { buildCollectionState } from '../EndpointState/EndpointState.js';
import { handleResponse } from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import interceptPostResponses from './PostInterceptor.js';

/** Lifecycle accessor surface returned by {@link buildLifecycleState}. */
interface ILifecycleHandle {
  readonly setCollectionActive: (active: boolean) => true;
}

/**
 * Attach the live `response` listener and the cross-frame POST/PUT
 * interceptor. Idempotency is enforced by {@link makeIdempotentAttacher}.
 * @param page - Playwright page.
 * @param captured - Mutable captured endpoints array.
 * @param readCollection - Predicate gating capture storage.
 * @returns True (always — sentinel for chaining).
 */
function attachLiveListeners(
  page: Page,
  captured: IDiscoveredEndpoint[],
  readCollection: () => boolean,
): true {
  /**
   * `page.on('response')` adapter that forwards each response to
   * `handleResponse` for parsing + storage.
   * @param response - Playwright response.
   * @returns True (always — fire-and-forget).
   */
  const onResponse = (response: Response): boolean =>
    handleResponse(captured, response, readCollection);
  page.on('response', onResponse);
  interceptPostResponses(page, captured);
  return true;
}

/**
 * Build an idempotent attacher closure. Eager mode calls it once
 * synchronously; deferred mode invokes it from the first
 * `setCollectionActive(true)` triggered by the trace-lifecycle
 * interceptor at the post-AUTH phase boundary.
 * @param page - Playwright page.
 * @param captured - Mutable captured endpoints array.
 * @param readCollection - Predicate gating capture storage.
 * @returns Idempotent attacher closure.
 */
function makeIdempotentAttacher(
  page: Page,
  captured: IDiscoveredEndpoint[],
  readCollection: () => boolean,
): () => boolean {
  let isAttached = false;
  return (): boolean => {
    if (isAttached) return false;
    attachLiveListeners(page, captured, readCollection);
    isAttached = true;
    return true;
  };
}

/**
 * Build the deferred-/eager-attach lifecycle state. Initial collection
 * state is false when deferring (no listeners yet, no captures), true
 * when eager (legacy test-friendly path).
 * @param page - Playwright page.
 * @param captured - Mutable captured endpoints array.
 * @param isDeferAttach - True to defer listener attach until first flip.
 * @returns Lifecycle handle exposing `setCollectionActive`.
 */
function buildLifecycleState(
  page: Page,
  captured: IDiscoveredEndpoint[],
  isDeferAttach: boolean,
): ILifecycleHandle {
  const collectionState = buildCollectionState(!isDeferAttach);
  const attachOnce = makeIdempotentAttacher(page, captured, collectionState.read);
  if (!isDeferAttach) attachOnce();
  /**
   * Toggle collection on/off; lazily attaches listeners the first
   * time collection is flipped to active.
   * @param active - True to enable capture storage.
   * @returns True (after the flag is set).
   */
  const setCollectionActive = (active: boolean): true => {
    if (active) attachOnce();
    return collectionState.flip(active);
  };
  return { setCollectionActive };
}

export default buildLifecycleState;
export type { ILifecycleHandle };
