/**
 * BIND-API-MEDIATOR client-version prime — discover a SPA build-version query
 * param (e.g. Max's `?v=V4.216-RC.4.116`) from the live page's resource-timing
 * buffer and stash it on the mediator session-context as `clientVersion`.
 *
 * Browser hard-model shapes read it (via `getSessionContext().clientVersion`)
 * to reconstruct versioned API URLs the generic pipeline used to copy verbatim
 * from live traffic. Opt-in per bank via `config.clientVersionParam` (the query
 * key to read); banks that omit it skip the scan entirely. Zero bank coupling.
 */

import type { Page } from 'playwright-core';

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.types.js';
import type { IPipelineBankConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';

/**
 * Scan the page's resource-timing buffer for the first request carrying
 * `?<param>=<value>` and return the decoded `<value>`. Self-contained so it
 * serializes cleanly into `page.evaluate`; only the param name crosses in.
 * @param page - Live login page.
 * @param param - Query key to read (e.g. 'v').
 * @returns Decoded param value, or '' when no resource carries it.
 */
async function discoverClientVersion(page: Page, param: string): Promise<string> {
  return page
    .evaluate((key: string): string => {
      const names = performance.getEntriesByType('resource').map((e): string => e.name);
      const parseable = names.filter((n): boolean => URL.canParse(n));
      const values = parseable.map((n): string => new URL(n).searchParams.get(key) ?? '');
      return values.find((v): boolean => v.length > 0) ?? '';
    }, param)
    .catch((): string => '');
}

/**
 * Prime the mediator session-context with the discovered client version for
 * banks that declare `clientVersionParam` (no-op otherwise). Merges into the
 * existing context so a primed token/snapshot is preserved.
 * @param config - Resolved bank config carrying `clientVersionParam`.
 * @param page - Live login page the version is read from.
 * @param mediator - Browser-page mediator to enrich.
 * @returns True when a version was stashed, false otherwise.
 */
async function primeClientVersion(
  config: IPipelineBankConfig,
  page: Page,
  mediator: IApiMediator,
): Promise<boolean> {
  const param = config.clientVersionParam;
  if (!param) return false;
  const version = await discoverClientVersion(page, param);
  if (!version) return false;
  const merged = { ...mediator.getSessionContext(), clientVersion: version };
  return mediator.setSessionContext(merged);
}

export default primeClientVersion;
export { primeClientVersion };
