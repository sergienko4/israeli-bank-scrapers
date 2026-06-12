/**
 * Factory for IElementMediator — wraps SelectorResolver + FormAnchor + FormErrorDiscovery.
 * Black box for ALL HTML resolution — scrapers describe WHAT, mediator finds HOW.
 * Each mediator instance has its own form anchor cache (no shared mutable state).
 *
 * Phase 12a final shape: this file is the THIN public façade. All cluster
 * builders, resolver implementations, action-mediator construction, and
 * phase-state pass-through live under `./Create/*` and are surfaced via
 * the `./Create/index.js` barrel.
 */

import type { Page } from 'playwright-core';

import { createNetworkDiscovery } from '../Network/NetworkDiscovery.js';
import { assembleElementMediator, type IFormCache, NO_FORM_ANCHOR } from './Create/index.js';
import { type IElementMediator } from './ElementMediator.js';

export { getActivePhase, getActiveStage } from './Create/index.js';

/**
 * Create an ElementMediator for the given page.
 * Each instance has its own form anchor cache — safe for concurrent use.
 * Production path: defer `page.on(...)` attachment until the
 * network-trace lifecycle interceptor flips the boundary gate ON
 * (post-AUTH phase). Keeps the HOME / WAF-check window listener-free
 * (see I-3 deferred-listener experiment 2026-05-13).
 * @param page - The Playwright page to resolve elements on.
 * @returns An IElementMediator with real implementations.
 */
function createElementMediator(page: Page): IElementMediator {
  const cache: IFormCache = { selector: NO_FORM_ANCHOR };
  const network = createNetworkDiscovery(page, { isDeferAttach: true });
  return { ...assembleElementMediator(page, cache), network };
}

export default createElementMediator;
export { createElementMediator };
export { extractActionMediator } from './Create/index.js';
