/**
 * Browser-only scraper options — the guard that makes an ignored browser option
 * audible on a bank whose selected transport runs no browser.
 *
 * <p>A headless bank whose identity transport is Node's own fetch (`native`) or
 * node:https (`node-tls`) never launches a browser or opens a page, so every
 * option that configures one has no reader on that run. The caller gets no
 * error and no effect unless this guard speaks. A bank with no headless block
 * stays silent: the Pipeline honours some of these options there, and the rest
 * are documented as ignored for every bank.
 *
 * <p>The transport comes from {@link resolveHeadlessTransportKind}, the same
 * selector the runtime uses to wire the mediator, so the warning and the
 * transport cannot disagree. Only option *names* are emitted, never values —
 * `executablePath` carries a filesystem path.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import { resolveHeadlessTransportKind } from './HeadlessMediatorWiring.js';
import { findSuppliedOptions, warnIgnoredOptions } from './SuppliedOptions.js';

/**
 * Options that configure a browser, its context or its page. Alphabetical, so
 * the warning lists them in a stable order regardless of caller insertion order.
 *
 * <p>No Pipeline bank launches a browser, so none of these has a reader:
 * every bank is API-direct and the browser engine was removed. `skipCloseBrowser`
 * is left out: {@link ./LegacyOnlyOptions.ts} already warns about it on every
 * Pipeline bank.
 */
export const BROWSER_ONLY_OPTIONS = [
  'args',
  'browser',
  'browserContext',
  'defaultTimeout',
  'executablePath',
  'prepareBrowser',
  'preparePage',
  'shouldShowBrowser',
  'timeout',
  'viewportSize',
] as const;

/** One of the option names only a browser run can honour. */
export type BrowserOnlyOption = (typeof BROWSER_ONLY_OPTIONS)[number];

/** Documentation the warning points at. */
const DOCS_URL =
  'https://sergienko4.github.io/israeli-bank-scrapers/configuration/#browser-options-on-browserless-banks';

/**
 * Report whether a bank's selected transport runs without a browser.
 * @param companyId - Bank the scrape targets.
 * @returns True for every bank with a headless block: each transport kind
 *   (`native` and `node-tls`) is browserless.
 */
function isBrowserlessBank(companyId: CompanyTypes): boolean {
  return resolveHeadlessTransportKind(companyId) !== false;
}

/**
 * Collect the browser-only options a caller supplied.
 * @param options - Caller-supplied scraper options.
 * @returns Supplied browser-only option names, in manifest order.
 */
export function findBrowserOnlyOptions(options: ScraperOptions): BrowserOnlyOption[] {
  return findSuppliedOptions(options, BROWSER_ONLY_OPTIONS);
}

/**
 * Compose the caller-facing warning text.
 * @param companyId - Bank the scrape targets.
 * @param ignored - Browser-only options the caller supplied.
 * @returns Warning naming the bank and every ignored option, but no values.
 */
function buildMessage(companyId: CompanyTypes, ignored: readonly BrowserOnlyOption[]): string {
  return [
    `"${companyId}" calls its bank API directly and never opens a browser, so`,
    `these browser options have no effect: ${ignored.join(', ')}.`,
    `They are ignored here. Remove them, or see ${DOCS_URL}`,
  ].join(' ');
}

/**
 * Warn the caller about every browser-only option a browserless bank ignores.
 * @param options - Caller-supplied scraper options.
 * @returns The ignored option names — empty for a clean bag or a bank that
 *   runs a browser.
 */
export function warnBrowserOnlyOptions(options: ScraperOptions): BrowserOnlyOption[] {
  if (!isBrowserlessBank(options.companyId)) return [];
  const ignored = findBrowserOnlyOptions(options);
  return warnIgnoredOptions(ignored, (names): string => buildMessage(options.companyId, names));
}
