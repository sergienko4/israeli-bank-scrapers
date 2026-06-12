/**
 * Assembly module — owns `assembleElementMediator`, the single
 * function that fuses every cluster bundle into a complete
 * `Omit<IElementMediator, 'network'>`. The façade in
 * `CreateElementMediator.ts` then layers `network` on top.
 *
 * Each spread preserves function identity — methods are the same
 * references the underlying `buildXxx(page)` helpers returned.
 */

import type { Page } from 'playwright-core';

import { type IElementMediator } from '../ElementMediator.js';
import { buildCookieCluster } from './Cookies.js';
import { type IFormCache } from './FieldResolve.js';
import { buildNavCluster } from './Navigation.js';
import { buildCountCluster } from './Observation.js';
import { buildStaticCluster } from './PhaseControls.js';
import { buildFormCluster, buildResolveCluster } from './Resolve.js';

export type { IFormCache };

/**
 * Compose the full method bundle for IElementMediator (everything
 * except `network`, which the factory inserts directly). Each spread
 * preserves function identity — methods are the same references the
 * underlying `buildXxx(page)` helpers returned.
 *
 * Structural composition under §19.4 cap=20 (Mediator/Elements/**) — the
 * 6 disjoint cluster spreads are the function's natural shape. CR cycle 5
 * suggested extracting a `CLUSTER_BUILDERS` array, but that requires inline
 * arrows which violate `jsdoc/require-jsdoc` (`ArrowFunctionExpression: true`).
 * Trade-off rejected per A3.5.7: refactor for cosmetic 13→10 line reduction
 * would add dispatch indirection without behavior change.
 * @param page - The Playwright page.
 * @param cache - The per-instance form-anchor cache.
 * @returns Method bundle covering every IElementMediator surface except `network`.
 */
export function assembleElementMediator(
  page: Page,
  cache: IFormCache,
): Omit<IElementMediator, 'network'> {
  return {
    ...buildResolveCluster(page),
    ...buildStaticCluster(),
    ...buildFormCluster(cache),
    ...buildNavCluster(page),
    ...buildCountCluster(page),
    ...buildCookieCluster(page),
  };
}
