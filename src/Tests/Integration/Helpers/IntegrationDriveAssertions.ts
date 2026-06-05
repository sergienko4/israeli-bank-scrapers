/**
 * IntegrationDriveAssertions — shared drive-and-assert helpers used by
 * BOTH Mode A (LoginFormDiscovery.integration.test.ts) and Mode B
 * (LoginNavigation.mirror.test.ts) integration suites. Extracted to
 * eliminate cross-suite duplication and drift risk (CR PR #310 cycle 4).
 *
 * <p>These helpers are pure utility — silent logger factory, page-context
 * teardown, discovery-result map-building, and field-resolution assertion.
 * They DO NOT touch the mirror or the static-fixture loader directly.
 */

import pino from 'pino';
import type { Page } from 'playwright-core';

import type { ILoginConfig } from '../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { executeDiscoverFields } from '../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.js';
import type { ScraperLogger } from '../../../Scrapers/Pipeline/Types/Debug.js';

/**
 * Silent logger satisfying the ScraperLogger contract — keeps drive
 * output quiet so jest dots stay clean.
 * @returns A pino instance with logging disabled.
 */
function makeSilentLogger(): ScraperLogger {
  return pino({ enabled: false });
}

/**
 * Close the page's context, swallowing teardown races so the cleanup
 * path never masks the original error from the caller.
 * @param page - Playwright page whose context should be torn down.
 * @returns True after teardown.
 */
async function closeQuietly(page: Page): Promise<true> {
  try {
    await page.context().close();
  } catch {
    // swallow: context may already be closing from a parallel afterAll
  }
  return true;
}

/**
 * Build a credentialKey → selector map from the discovery result.
 * Used by both Mode A and Mode B drive flows.
 * @param result - Discovery result from executeDiscoverFields.
 * @returns Read-only map of credentialKey → resolved selector.
 */
function buildResolvedMap(
  result: Awaited<ReturnType<typeof executeDiscoverFields>>,
): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  for (const [key, target] of result.targets.entries()) {
    resolved.set(key, target.selector);
  }
  return resolved;
}

/**
 * Assert every credential field declared in the LOGIN config was
 * resolved by the drive call. Pure map-presence check — does NOT touch
 * the page.
 * @param cfg - Bank LOGIN config.
 * @param resolved - Resolved selectors by credentialKey.
 * @returns Number of fields verified (equals `cfg.fields.length` on success).
 */
function assertAllFieldsResolved(cfg: ILoginConfig, resolved: ReadonlyMap<string, string>): number {
  for (const field of cfg.fields) {
    if (!resolved.has(field.credentialKey)) {
      throw new ScraperError(`field ${field.credentialKey} was not resolved by drive`);
    }
    const wasResolved = resolved.has(field.credentialKey);
    expect(wasResolved).toBe(true);
  }
  return cfg.fields.length;
}

export { assertAllFieldsResolved, buildResolvedMap, closeQuietly, makeSilentLogger };
