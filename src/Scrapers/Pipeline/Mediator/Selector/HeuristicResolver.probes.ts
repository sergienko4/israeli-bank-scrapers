/**
 * Locator probes for HeuristicResolver — fail-soft wrappers around
 * playwright Locator queries so a flaky frame can't crash resolution.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { IFieldMatch } from './SelectorResolverPipeline.js';

/**
 * Build the standard "empty miss" field match for a Page/Frame context.
 * @param ctx - Page or Frame that owns the negative result.
 * @returns IFieldMatch with empty selector.
 */
function emptyMatch(ctx: Page | Frame): IFieldMatch {
  return { selector: '', context: ctx };
}

/**
 * Compose an `#id` selector when an id is present, otherwise return the fallback.
 * @param fallback - Selector used when no element id is present.
 * @param id - DOM id (empty string ⇒ no id).
 * @returns Best-available selector.
 */
function buildIdSelector(fallback: string, id: string): string {
  return id ? `#${id}` : fallback;
}

/**
 * Probe `locator.count()` swallowing playwright failures (defaults to 0).
 * @param locator - Locator to probe.
 * @returns Element count, 0 on failure.
 */
async function probeLocatorCount(locator: Locator): Promise<number> {
  return locator.count().catch((): number => 0);
}

/**
 * Probe `locator.isVisible()` swallowing playwright failures (defaults to false).
 * @param locator - Locator to probe.
 * @returns True when visible, false otherwise.
 */
async function probeLocatorVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch((): boolean => false);
}

/**
 * Probe `locator.isEnabled()` swallowing playwright failures (defaults to false).
 * @param locator - Locator to probe.
 * @returns True when enabled, false otherwise.
 */
async function probeLocatorEnabled(locator: Locator): Promise<boolean> {
  return locator.isEnabled().catch((): boolean => false);
}

/**
 * Probe a locator's DOM `id` attribute, returning '' on miss or failure.
 * @param locator - Locator to probe.
 * @returns DOM id or empty string.
 */
async function probeLocatorId(locator: Locator): Promise<string> {
  const id = await locator.getAttribute('id').catch((): string => '');
  return id ?? '';
}

export {
  buildIdSelector,
  emptyMatch,
  probeLocatorCount,
  probeLocatorEnabled,
  probeLocatorId,
  probeLocatorVisible,
};
