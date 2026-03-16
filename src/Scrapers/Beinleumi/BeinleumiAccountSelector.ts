import { type Frame, type Page } from 'playwright-core';

import { getDebug } from '../../Common/Debug.js';
import { clickButton, waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import {
  ACCOUNT_SELECTOR,
  DROPDOWN_PANEL_SELECTOR,
  ELEMENT_RENDER_TIMEOUT_MS,
  IFRAME_NAME,
  OPTION_SELECTOR,
  TRANSACTIONS_FRAME_LOAD_ATTEMPTS,
  TRANSACTIONS_FRAME_WAIT_MS,
} from './Config/BeinleumiAccountSelectorConfig.js';

const LOG = getDebug('beinleumi-account-selector');

/**
 * Check whether the account dropdown panel is currently visible.
 * @param page - The Playwright page instance.
 * @returns True if the dropdown is open.
 */
async function isDropdownOpen(page: Page): Promise<boolean> {
  return page
    .locator(DROPDOWN_PANEL_SELECTOR)
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Ensure the account dropdown is open, clicking the trigger if needed.
 * @param page - The Playwright page instance.
 * @returns True if dropdown was already open, false if it had to be opened.
 */
async function ensureDropdownOpen(page: Page): Promise<boolean> {
  if (await isDropdownOpen(page)) return true;
  await waitUntilElementFound(page, ACCOUNT_SELECTOR, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  await clickButton(page, ACCOUNT_SELECTOR);
  await waitUntilElementFound(page, DROPDOWN_PANEL_SELECTOR, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  return false;
}

/**
 * Read non-empty text labels from all account options.
 * @param page - The Playwright page instance.
 * @returns Array of trimmed, non-empty option label strings.
 */
async function readOptionLabels(page: Page): Promise<string[]> {
  const loc = page.locator(OPTION_SELECTOR);
  const allTexts = await loc.allInnerTexts();
  return allTexts.map(t => t.trim()).filter(t => t !== '');
}

/**
 * Open the account dropdown and return all visible account labels.
 * @param page - The Playwright page instance.
 * @returns Array of account label strings.
 */
export async function clickAccountSelectorGetAccountIds(page: Page): Promise<string[]> {
  try {
    const wasOpen = await ensureDropdownOpen(page);
    LOG.debug('dropdown %s', wasOpen ? 'already open' : 'opened');
    return await readOptionLabels(page);
  } catch {
    return [];
  }
}

/**
 * Retrieve account IDs from the legacy UI select element.
 * @param page - The Playwright page instance.
 * @returns Array of account ID strings from the select element.
 */
async function getAccountIdsOldUI(page: Page): Promise<string[]> {
  const optionLoc = page.locator('select[id="account_num_select"] option');
  const options = await optionLoc.all();
  const getValueTasks = options.map(o => o.getAttribute('value'));
  const values = await Promise.all(getValueTasks);
  return values.filter((v): v is string => v !== null && v !== '');
}

/**
 * Try both new and old UI to retrieve account IDs.
 * @param page - The Playwright page instance.
 * @returns Array of account ID strings from whichever UI is present.
 */
export async function getAccountIdsBothUIs(page: Page): Promise<string[]> {
  let accountsIds: string[] = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) accountsIds = await getAccountIdsOldUI(page);
  return accountsIds;
}

/**
 * Click the dropdown option matching the given account label.
 * @param page - The Playwright page instance.
 * @param accountLabel - The label text to match.
 * @returns True if a matching option was clicked.
 */
async function clickMatchingOption(page: Page, accountLabel: string): Promise<boolean> {
  const optionsLoc = page.locator(OPTION_SELECTOR);
  const allOptions = await optionsLoc.all();
  const textPromises = allOptions.map(o => o.innerText());
  const texts = await Promise.all(textPromises);
  const matchIdx = texts.findIndex(t => t.trim() === accountLabel);
  if (matchIdx < 0) return false;
  await allOptions[matchIdx].click();
  return true;
}

/**
 * Open the dropdown and select the account matching the given label.
 * @param page - The Playwright page instance.
 * @param accountLabel - The label text of the account to select.
 * @returns True if the account was found and selected.
 */
export async function selectAccountFromDropdown(
  page: Page,
  accountLabel: string,
): Promise<boolean> {
  const availableAccounts = await clickAccountSelectorGetAccountIds(page);
  if (!availableAccounts.includes(accountLabel)) return false;
  await waitUntilElementFound(page, OPTION_SELECTOR, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  return clickMatchingOption(page, accountLabel);
}

type OptionalFrame = Frame | undefined;

/**
 * Try a single attempt to locate the transactions iframe by name.
 * @param page - The Playwright page instance.
 * @param attempt - Zero-based attempt index for logging.
 * @returns The frame if found, or undefined if not yet available.
 */
async function tryGetFrameAttempt(page: Page, attempt: number): Promise<OptionalFrame> {
  await page.waitForTimeout(TRANSACTIONS_FRAME_WAIT_MS);
  const byName = page.frames().find(f => f.name() === IFRAME_NAME);
  if (byName) return byName;
  LOG.debug(
    'attempt %d/%d: transactions frame not found, retrying...',
    attempt + 1,
    TRANSACTIONS_FRAME_LOAD_ATTEMPTS,
  );
  const notFound: OptionalFrame = undefined;
  return notFound;
}

/**
 * Locate the transactions iframe, retrying several times.
 * @param page - The Playwright page instance.
 * @returns The transactions frame, or undefined if not found after all attempts.
 */
export async function getTransactionsFrame(page: Page): Promise<OptionalFrame> {
  const attempts = Array.from({ length: TRANSACTIONS_FRAME_LOAD_ATTEMPTS }, (_, i) => i);
  const initialFrame: Promise<OptionalFrame> = Promise.resolve(undefined);
  const frame = await attempts.reduce<Promise<OptionalFrame>>(async (prev, attempt) => {
    const found = await prev;
    if (found) return found;
    return tryGetFrameAttempt(page, attempt);
  }, initialFrame);
  if (!frame) {
    LOG.debug(
      'getTransactionsFrame: failed to find frame after %d attempts',
      TRANSACTIONS_FRAME_LOAD_ATTEMPTS,
    );
  }
  return frame;
}
