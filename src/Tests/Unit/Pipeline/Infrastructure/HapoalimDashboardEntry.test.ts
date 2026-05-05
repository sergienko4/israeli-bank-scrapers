/*
 * @jest-environment jsdom
 *
 * Hapoalim dashboard-entry selector test — jsdom-based.
 *
 * Loads the committed REDACTED dashboard HTML fixture and asserts the
 * `לעובר ושב` drill-in link is present with the expected href. This
 * proves the WK_DASHBOARD.TRANSACTIONS candidate matches Hapoalim's
 * dashboard shape BEFORE any live run is required.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WK_DASHBOARD } from '../../../../Scrapers/Pipeline/Registry/WK/DashboardWK.js';

type HrefValue = string;
type ElementText = string;
/** Sentinel returned when no anchor matches. Rule #15: no null/undefined. */
type NoAnchor = false;
type MaybeAnchor = HTMLAnchorElement | NoAnchor;

/** Loaded fixture: raw HTML + resolved DOM root. */
interface IFixtureDom {
  readonly root: HTMLElement;
}

/**
 * Resolve fixture directory via import.meta.url (ESM-safe).
 * @returns Absolute path to the hapoalim-dashboard folder.
 */
function fixtureDir(): string {
  const fileUrl = import.meta.url;
  const thisFile = fileURLToPath(fileUrl);
  const here = path.dirname(thisFile);
  return path.join(here, 'fixtures', 'hapoalim-dashboard');
}

/**
 * Load the redacted dashboard HTML into document.body.
 * @returns Fixture wrapper holding the DOM root.
 */
function loadDashboardFixture(): IFixtureDom {
  const dir = fixtureDir();
  const htmlPath = path.join(dir, 'dashboard.html');
  const raw = fs.readFileSync(htmlPath, 'utf8');
  document.body.innerHTML = raw;
  return { root: document.body };
}

/**
 * Find the first anchor whose visible text exactly matches `value`.
 * Mirrors the `clickableText` kind used by the resolver.
 * @param root - DOM root to search.
 * @param value - Expected text content.
 * @returns First matching anchor or `false` when none.
 */
function findAnchorByText(root: HTMLElement, value: ElementText): MaybeAnchor {
  const nodeList = root.querySelectorAll('a');
  const anchors = Array.from(nodeList);
  const match = anchors.find((a): boolean => a.textContent.trim() === value);
  return match ?? false;
}

/**
 * Pull out the `clickableText` values from the TRANSACTIONS WK bucket.
 * @returns Array of candidate strings.
 */
function transactionTextCandidates(): readonly ElementText[] {
  const buckets = WK_DASHBOARD.TRANSACTIONS;
  return buckets
    .filter((c): boolean => c.kind === 'clickableText')
    .map((c): ElementText => c.value);
}

/**
 * Check whether any TRANSACTIONS candidate resolves to a visible anchor.
 * @param root - DOM root.
 * @returns The matched text, or empty string when none match.
 */
function resolveAnyTransactionsAnchor(root: HTMLElement): ElementText {
  const candidates = transactionTextCandidates();
  const hit = candidates
    .map((text): { text: ElementText; anchor: MaybeAnchor } => ({
      text,
      anchor: findAnchorByText(root, text),
    }))
    .find((r): boolean => r.anchor !== false);
  return hit ? hit.text : '';
}

describe('Hapoalim dashboard — WK_DASHBOARD.TRANSACTIONS selector', () => {
  const dom = loadDashboardFixture();

  it('fixture dashboard.html loads into the JSDOM body', () => {
    expect(dom.root.childElementCount).toBeGreaterThan(0);
  });

  it('at least one TRANSACTIONS candidate resolves to an anchor', () => {
    const matched = resolveAnyTransactionsAnchor(dom.root);
    expect(matched).not.toBe('');
  });

  it('the matched anchor has an href leading to the transactions page', () => {
    const matched = resolveAnyTransactionsAnchor(dom.root);
    const anchor = findAnchorByText(dom.root, matched);
    const isFound = anchor !== false;
    expect(isFound).toBe(true);
    const hrefAttr = isFound ? anchor.getAttribute('href') : '';
    const href: HrefValue = hrefAttr ?? '';
    const hasTxnPath = href.includes('/current-account/transactions');
    expect(hasTxnPath).toBe(true);
  });

  it('specifically finds "לעובר ושב" with a valid href', () => {
    const anchor = findAnchorByText(dom.root, 'לעובר ושב');
    const isFound = anchor !== false;
    expect(isFound).toBe(true);
    const hrefAttr = isFound ? anchor.getAttribute('href') : '';
    const href: HrefValue = hrefAttr ?? '';
    expect(href).toBe('/ng-portals/rb/he/current-account/transactions');
  });
});
