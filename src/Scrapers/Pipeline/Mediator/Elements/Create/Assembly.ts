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
