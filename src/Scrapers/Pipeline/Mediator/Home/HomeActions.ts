/**
 * HOME phase actions — login entry point discovery + click.
 * Uses ONLY WK_HOME. Never imports from PreLoginWK or LoginWK.
 * Strict State Machine: each phase owns its own WK.
 */

import type { Locator, Page } from 'playwright-core';

import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/** Raw href attribute value from an anchor element. */
type HrefAttr = string;
/** Index of the first visible locator from a set. */
type VisibleIndex = number;
/** Whether a login link became visible within the timeout. */
type FieldReady = boolean;

/** Timeout for waiting for page readiness (login link visible). */
const PAGE_READINESS_TIMEOUT = 30000;

/**
 * Try to click a login link using WellKnown loginLink candidates.
 * @param mediator - Element mediator with resolver.
 * @returns Procedure with IRaceResult.
 */
async function tryClickLoginLink(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  return mediator.resolveAndClick(WK_HOME.ENTRY);
}

/**
 * Click the login entry point. Always clicks — HOME activates the entry.
 * href="/login" navigates. href="#" triggers SPA modal. Both valid.
 * PRE-LOGIN handles what comes next.
 * @param mediator - Element mediator.
 * @returns Procedure with IRaceResult.
 */
async function tryClickLoginLinkWithHref(
  mediator: IElementMediator,
): Promise<Procedure<IRaceResult>> {
  const candidates = WK_HOME.ENTRY;
  const visible = await mediator.resolveVisible(candidates).catch((): false => false);
  if (!visible || !visible.found || !visible.locator) return tryClickLoginLink(mediator);
  const emptyHref: HrefAttr = '';
  const rawHref = await visible.locator.getAttribute('href').catch((): HrefAttr => emptyHref);
  const href = rawHref ?? emptyHref;
  process.stderr.write(`    [HOME.ACTION] entry="${visible.value}" href="${href}"\n`);
  await visible.locator.click();
  await mediator.waitForNetworkIdle(15000).catch((): false => false);
  const afterUrl = mediator.getCurrentUrl();
  process.stderr.write(`    [HOME.ACTION] after click+settle → ${afterUrl}\n`);
  return succeed(visible);
}

/**
 * Wait for any WellKnown loginLink candidate to become visible.
 * @param browserPage - Browser page.
 * @returns True if any login link became visible, false on timeout.
 */
async function waitForAnyLoginLink(browserPage: Page): Promise<FieldReady> {
  const candidates = WK_HOME.ENTRY;
  const locators = candidates.map((c): Locator => browserPage.getByText(c.value).first());
  const waiters = locators.map(async (loc, i): Promise<VisibleIndex> => {
    await loc.waitFor({ state: 'visible', timeout: PAGE_READINESS_TIMEOUT });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results.some((r): FieldReady => r.status === 'fulfilled');
}

export { tryClickLoginLink, tryClickLoginLinkWithHref, waitForAnyLoginLink };
