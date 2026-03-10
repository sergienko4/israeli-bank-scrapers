import { type Locator, type Page } from 'playwright';

import { WELL_KNOWN_LOGIN_SELECTORS } from '../Scrapers/Registry/WellKnownSelectors.js';

type WellKnownFieldKey = keyof typeof WELL_KNOWN_LOGIN_SELECTORS;

/**
 * Build a Playwright locator matching any WellKnown placeholder for a field.
 * Uses the placeholder candidates from WELL_KNOWN_LOGIN_SELECTORS to build a regex.
 * @param scope - The page or locator to search within.
 * @param fieldKey - The WellKnown field key (e.g. 'username', 'id', 'password').
 * @returns A locator matching the first WellKnown placeholder found in the scope.
 */
export function wellKnownPlaceholder(scope: Page | Locator, fieldKey: WellKnownFieldKey): Locator {
  const placeholders = WELL_KNOWN_LOGIN_SELECTORS[fieldKey]
    .filter(candidate => candidate.kind === 'placeholder')
    .map(candidate => candidate.value);
  const pattern = new RegExp(placeholders.join('|'));
  return scope.getByPlaceholder(pattern).first();
}

/**
 * Build a Playwright locator for the submit button using WellKnown ariaLabel values.
 * @param scope - The page or locator to search within.
 * @returns A locator matching the first WellKnown submit button found.
 */
export function wellKnownSubmitButton(scope: Page | Locator): Locator {
  const labels = WELL_KNOWN_LOGIN_SELECTORS.__submit__
    .filter(candidate => candidate.kind === 'ariaLabel')
    .map(candidate => candidate.value);
  const pattern = new RegExp(labels.join('|'));
  return scope.getByRole('button', { name: pattern });
}

/**
 * Find the parent form element containing a WellKnown field.
 * Locates the field by placeholder, then walks up to its ancestor form.
 * @param page - The Playwright page to search.
 * @param fieldKey - The WellKnown field key to anchor on (e.g. 'username').
 * @returns A Locator scoped to the form containing the field.
 */
export function findFormByField(page: Page, fieldKey: WellKnownFieldKey): Locator {
  const field = wellKnownPlaceholder(page, fieldKey);
  return field.locator('xpath=ancestor::form');
}
