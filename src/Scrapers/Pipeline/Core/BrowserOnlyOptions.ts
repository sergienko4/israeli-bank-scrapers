/**
 * Browser-only scraper options — the guard that makes an ignored browser option
 * audible on a bank whose selected transport runs no browser.
 *
 * <p>A headless bank whose identity transport is Node's own fetch (`native`) or
 * node:https (`node-tls`) never launches a browser or opens a page, so every
 * option that configures one has no reader on that run. The caller gets no
 * error and no effect unless this guard speaks. Browser-backed transports and
 * browser banks stay silent: the Pipeline honours some of these options there,
 * and the rest are documented as ignored for every bank.
 *
 * <p>The transport comes from {@link resolveHeadlessTransportKind}, the same
 * selector the runtime uses to wire the mediator, so the warning and the
 * transport cannot disagree. Only option *names* are emitted, never values —
 * `executablePath` carries a filesystem path.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import {
  type HeadlessTransportKind,
  resolveHeadlessTransportKind,
} from './HeadlessMediatorWiring.js';
import { findSuppliedOptions, warnIgnoredOptions } from './SuppliedOptions.js';

/**
 * Options that configure a browser, its context or its page. Alphabetical, so
 * the warning lists them in a stable order regardless of caller insertion order.
 *
 * <p>Each entry is pinned to its reader, or to "no reader". `skipCloseBrowser`
 * is left out: {@link ./LegacyOnlyOptions.ts} already warns about it on every
 * Pipeline bank.
 * - `args` — no reader (launch flags come from the bundled Camoufox profile)
 * - `browser` — no reader (the legacy launcher that honoured it was removed)
 * - `browserContext` — no reader (the legacy launcher that honoured it was removed)
 * - `defaultTimeout` — `Mediator/Browser/BrowserLifecycle.ts` page setup
 * - `executablePath` — no reader (the bundled Camoufox binary is always used)
 * - `prepareBrowser` — `Mediator/Browser/BrowserLifecycle.ts` `launchBrowser`
 * - `preparePage` — `Mediator/Browser/BrowserLifecycle.ts` page setup
 * - `shouldShowBrowser` — `Mediator/Browser/BrowserLifecycle.ts` `launchBrowser`
 * - `timeout` — no reader (`defaultTimeout` is the honoured one)
 * - `viewportSize` — no reader (contexts are created with `viewport: null`)
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

/** Whether each headless transport runs without any browser. */
const IS_BROWSERLESS: Readonly<Record<HeadlessTransportKind, boolean>> = {
  native: true,
  'node-tls': true,
  browser: false,
};

/** Documentation the warning points at. */
const DOCS_URL =
  'https://sergienko4.github.io/israeli-bank-scrapers/configuration/#browser-options-on-browserless-banks';

/**
 * Report whether a bank's selected transport runs without a browser.
 * @param companyId - Bank the scrape targets.
 * @returns True for the `native` and `node-tls` transports.
 */
function isBrowserlessBank(companyId: CompanyTypes): boolean {
  const kind = resolveHeadlessTransportKind(companyId);
  if (kind === false) return false;
  return IS_BROWSERLESS[kind];
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
