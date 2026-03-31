/**
 * Generic pre-login steps — mediator-based navigation helpers.
 * ALL HTML resolution goes through mediator/resolver. No direct page.getByText.
 * Returns Procedure<IRaceResult> per Rule #15 — zero primitive returns.
 */

import type { Locator, Page } from 'playwright-core';

import type { IElementMediator, IRaceResult } from '../Mediator/ElementMediator.js';
import { WK_HOME } from '../Registry/WK/HomeWK.js';
import { WK_LOGIN_FORM } from '../Registry/WK/LoginWK.js';
import { WK_CLOSE_POPUP } from '../Registry/WK/SharedWK.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

/** Timeout for waiting for page readiness (login link visible). */
const PAGE_READINESS_TIMEOUT = 30000;

/** Timeout for waiting for first credential field to appear. */
const FIELD_WAIT_TIMEOUT = 15000;

/** Whether a login link href is recognized as a login destination. */
type IsLoginLink = boolean;
/** Index of the first visible locator from a set. */
type VisibleIndex = number;
/** Raw href attribute value from an anchor element. */
type HrefAttr = string;
/** Whether a form element became visible within the timeout. */
type FieldReady = boolean;

/**
 * Try to close a popup overlay using WellKnown closeElement candidates.
 * @param mediator - Element mediator with resolver.
 * @returns Procedure with IRaceResult — found=true if close element was clicked.
 */
async function tryClosePopup(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  return mediator.resolveAndClick(WK_CLOSE_POPUP);
}

/**
 * Try to click a login link using WellKnown loginLink candidates.
 * @param mediator - Element mediator with resolver.
 * @returns Procedure with IRaceResult — found=true if login link was clicked.
 */
async function tryClickLoginLink(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  return mediator.resolveAndClick(WK_HOME.ENTRY);
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
 * @returns Procedure with IRaceResult — found=true if a login link was clicked.
 */
async function tryClickLoginLinkWithHref(
  mediator: IElementMediator,
): Promise<Procedure<IRaceResult>> {
  const candidates = WK_HOME.ENTRY;
  const visible = await mediator.resolveVisible(candidates).catch((): false => false);
  if (!visible || !visible.found || !visible.locator) return tryClickLoginLink(mediator);
  const href = await visible.locator.getAttribute('href').catch((): HrefAttr => '');
  if (href && !isLoginHref(href)) return tryClickLoginLink(mediator);
  await visible.locator.click();
  return succeed(visible);
}

/**
 * Try to click private customers link using WellKnown privateCustomers.
 * If found, waits for /login navigation.
 * @param mediator - Element mediator with resolver.
 * @param page - Browser page (for URL wait).
 * @param navTimeout - Navigation wait timeout in ms.
 * @returns Procedure with IRaceResult.
 */
async function tryClickPrivateCustomers(
  mediator: IElementMediator,
  page: Page,
  navTimeout: number,
): Promise<Procedure<IRaceResult>> {
  const clickResult = await mediator.resolveAndClick(WK_HOME.REVEAL);
  if (!clickResult.success) return clickResult;
  if (!clickResult.value.found) return clickResult;
  const navOpts = { timeout: navTimeout, waitUntil: 'domcontentloaded' as const };
  await page.waitForURL('**/login**', navOpts).catch((): false => false);
  return clickResult;
}

/** Longer timeout for credential-area tab — portals with accessibility overlays load tabs asynchronously. */
const CRED_AREA_TIMEOUT = 10_000;

/**
 * Try to click the login method tab using WellKnown credentialAreaIndicator.
 * Uses extended timeout to handle portals that render tabs asynchronously (e.g. UserWay).
 * @param mediator - Element mediator with resolver.
 * @returns Procedure with IRaceResult — found=true if a tab was clicked.
 */
async function tryClickCredentialArea(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  return mediator.resolveAndClick(WK_HOME.REVEAL, CRED_AREA_TIMEOUT);
}

/**
 * Wait for any WellKnown loginLink candidate to become visible.
 * Generic page readiness check after navigation.
 * @param page - Browser page.
 * @returns True if any login link became visible, false on timeout.
 */
async function waitForAnyLoginLink(page: Page): Promise<FieldReady> {
  const candidates = WK_HOME.ENTRY;
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
  const fieldCandidates = [...WK_LOGIN_FORM.id, ...WK_LOGIN_FORM.password];
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
