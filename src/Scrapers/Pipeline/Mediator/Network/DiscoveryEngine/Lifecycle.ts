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
 * `page.on('response')` adapter that forwards each response to
 * `handleResponse` for parsing + storage. Hoisted to top-level so
 * {@link attachLiveListeners} can use `.bind(null, ...)` instead of
 * an inline arrow.
 * @param captured - Mutable captured endpoints array.
 * @param readCollection - Predicate gating capture storage.
 * @param response - Playwright response.
 * @returns True (always — fire-and-forget).
 */
function onResponseFor(
  captured: IDiscoveredEndpoint[],
  readCollection: () => boolean,
  response: Response,
): boolean {
  return handleResponse(captured, response, readCollection);
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
  const onResponse = onResponseFor.bind(null, captured, readCollection);
  page.on('response', onResponse);
  interceptPostResponses(page, captured);
  return true;
}

/** Mutable cell tracking whether listeners have been attached. */
interface IAttachState {
  isAttached: boolean;
}

/** Constructor args bag for {@link attachIfNeeded}. */
interface IAttachArgs {
  readonly page: Page;
  readonly captured: IDiscoveredEndpoint[];
  readonly readCollection: () => boolean;
}

/**
 * Idempotent attacher core: attaches listeners exactly once.
 * @param state - Mutable attached flag.
 * @param args - Args forwarded to {@link attachLiveListeners}.
 * @returns True when listeners were attached this call, false if already attached.
 */
function attachIfNeeded(state: IAttachState, args: IAttachArgs): boolean {
  if (state.isAttached) return false;
  attachLiveListeners(args.page, args.captured, args.readCollection);
  state.isAttached = true;
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
  const state: IAttachState = { isAttached: false };
  return attachIfNeeded.bind(null, state, { page, captured, readCollection });
}

/** Click-state slice exposed to {@link flipCollection}. */
interface ICollectionToggle {
  readonly flip: (active: boolean) => true;
}

/**
 * Toggle collection on/off; lazily attaches listeners the first
 * time collection is flipped to active.
 * @param attachOnce - Idempotent attacher closure.
 * @param collectionState - Collection-state toggle.
 * @param active - True to enable capture storage.
 * @returns True (after the flag is set).
 */
function flipCollection(
  attachOnce: () => boolean,
  collectionState: ICollectionToggle,
  active: boolean,
): true {
  if (active) attachOnce();
  return collectionState.flip(active);
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
  return { setCollectionActive: flipCollection.bind(null, attachOnce, collectionState) };
}

export default buildLifecycleState;
export type { ILifecycleHandle };
