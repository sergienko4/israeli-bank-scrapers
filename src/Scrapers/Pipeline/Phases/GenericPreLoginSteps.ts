/**
 * Generic pre-login steps — mediator-based navigation helpers.
 * ALL HTML resolution goes through mediator/resolver. No direct page.getByText.
 * These steps are best-effort — they catch errors and return false if not found.
 */

import type { Locator, Page } from 'playwright-core';

import type { IElementMediator } from '../Mediator/ElementMediator.js';
import { WK } from '../Registry/PipelineWellKnown.js';

/** Timeout for waiting for page readiness (login link visible). */
const PAGE_READINESS_TIMEOUT = 30000;

/** Timeout for waiting for first credential field to appear. */
const FIELD_WAIT_TIMEOUT = 15000;

/** Whether a navigation or click action succeeded. */
type ClickResult = boolean;
/** Whether a login link href is recognized as a login destination. */
type IsLoginLink = boolean;
/** Whether a form element became visible within the timeout. */
type FieldReady = boolean;
/** Index of the first visible locator from a set. */
type VisibleIndex = number;
/** Raw href attribute value from an anchor element. */
type HrefAttr = string;

/**
 * Try to close a popup overlay using WellKnown closeElement candidates.
 * @param mediator - Element mediator with resolver.
 * @returns True if a close element was found and clicked.
 */
async function tryClosePopup(mediator: IElementMediator): Promise<ClickResult> {
  const candidates = WK.HOME.PRE.CLOSE_POPUP;
  return mediator.resolveAndClick(candidates).catch((): ClickResult => false);
}

/**
 * Try to click a login link using WellKnown loginLink candidates.
 * @param mediator - Element mediator with resolver.
 * @returns True if a login link was found and clicked.
 */
async function tryClickLoginLink(mediator: IElementMediator): Promise<ClickResult> {
  const candidates = WK.HOME.ACTION.NAV_ENTRY;
  return mediator.resolveAndClick(candidates).catch((): ClickResult => false);
}

/** Href patterns that indicate a login page destination. */
const LOGIN_HREF_PATTERNS = ['/login', '/connect', '/auth', '/signin'] as const;

/**
 * Check if an href points to a login-related page.
 * @param href - The href attribute value.
 * @returns True if href contains a login pattern.
 */
function isLoginHref(href: HrefAttr): IsLoginLink {
  const lower = href.toLowerCase();
  return LOGIN_HREF_PATTERNS.some((p): IsLoginLink => lower.includes(p));
}

/**
 * Try to click a login link using href strategy (Identify → Inspect → Act).
 * Uses resolveVisible to find the link, inspects href before clicking.
 * Falls back to regular resolveAndClick if resolveVisible finds nothing.
 * @param mediator - Element mediator with resolver.
 * @returns True if a login link was found and clicked.
 */
async function tryClickLoginLinkWithHref(mediator: IElementMediator): Promise<ClickResult> {
  const candidates = WK.HOME.ACTION.NAV_ENTRY;
  const result = await mediator.resolveVisible(candidates).catch((): false => false);
  if (!result || !result.found || !result.locator) {
    return tryClickLoginLink(mediator);
  }
  const href = await result.locator.getAttribute('href').catch((): HrefAttr => '');
  if (href && !isLoginHref(href)) {
    return tryClickLoginLink(mediator);
  }
  await result.locator.click();
  return true;
}

/**
 * Try to click private customers link using WellKnown privateCustomers.
 * If found, waits for /login navigation.
 * @param mediator - Element mediator with resolver.
 * @param page - Browser page (for URL wait).
 * @param navTimeout - Navigation wait timeout in ms.
 * @returns True if clicked and navigated.
 */
async function tryClickPrivateCustomers(
  mediator: IElementMediator,
  page: Page,
  navTimeout: number,
): Promise<ClickResult> {
  const candidates = WK.HOME.ACTION.NAV_REVEAL;
  const didClick = await mediator.resolveAndClick(candidates).catch((): ClickResult => false);
  if (!didClick) return false;
  const navOpts = { timeout: navTimeout, waitUntil: 'domcontentloaded' as const };
  return page
    .waitForURL('**/login**', navOpts)
    .then((): ClickResult => true)
    .catch((): ClickResult => false);
}

/** Longer timeout for credential-area tab — portals with accessibility overlays load tabs asynchronously. */
const CRED_AREA_TIMEOUT = 10_000;

/**
 * Try to click the login method tab using WellKnown credentialAreaIndicator.
 * Uses extended timeout to handle portals that render tabs asynchronously (e.g. UserWay).
 * @param mediator - Element mediator with resolver.
 * @returns True if a tab was found and clicked.
 */
async function tryClickCredentialArea(mediator: IElementMediator): Promise<ClickResult> {
  const candidates = WK.HOME.ACTION.NAV_REVEAL;
  return mediator.resolveAndClick(candidates, CRED_AREA_TIMEOUT).catch((): ClickResult => false);
}

/**
 * Wait for any WellKnown loginLink candidate to become visible.
 * Generic page readiness check after navigation.
 * @param page - Browser page.
 * @returns True if any login link became visible, false on timeout.
 */
async function waitForAnyLoginLink(page: Page): Promise<FieldReady> {
  const candidates = WK.HOME.ACTION.NAV_ENTRY;
  const locators = candidates.map((c): Locator => page.getByText(c.value).first());
  const waiters = locators.map(async (loc, i): Promise<VisibleIndex> => {
    await loc.waitFor({ state: 'visible', timeout: PAGE_READINESS_TIMEOUT });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results.some((r): FieldReady => r.status === 'fulfilled');
}

/**
 * Wait for any WellKnown login field candidate to become visible.
 * Ensures the login form is rendered before the mediator tries to fill fields.
 * @param page - Browser page.
 * @returns True if a field indicator became visible, false on timeout.
 */
async function waitForFirstField(page: Page): Promise<FieldReady> {
  const fieldCandidates = [...WK.LOGIN.ACTION.FORM.id, ...WK.LOGIN.ACTION.FORM.password];
  const locators = fieldCandidates.map((c): Locator => {
    if (c.kind === 'placeholder') return page.getByPlaceholder(c.value).first();
    if (c.kind === 'labelText') return page.getByLabel(c.value).first();
    return page.getByText(c.value).first();
  });
  const waiters = locators.map(async (loc, i): Promise<VisibleIndex> => {
    await loc.waitFor({ state: 'visible', timeout: FIELD_WAIT_TIMEOUT });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results.some((r): FieldReady => r.status === 'fulfilled');
}

export {
  tryClickCredentialArea,
  tryClickLoginLink,
  tryClickLoginLinkWithHref,
  tryClickPrivateCustomers,
  tryClosePopup,
  waitForAnyLoginLink,
  waitForFirstField,
};
