import { type Frame, type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { clickButton, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { sleep } from '../../Common/Waiting';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';

const LOG = getDebug('beinleumi-account-selector');

const ACCOUNT_SELECTOR = 'div.current-account';
const DROPDOWN_PANEL_SELECTOR = 'div.mat-mdc-autocomplete-panel.account-select-dd';
const OPTION_SELECTOR = 'mat-option .mdc-list-item__primary-text';

const ELEMENT_RENDER_TIMEOUT_MS = 10000;
const IFRAME_NAME = 'iframe-old-pages';
const TRANSACTIONS_FRAME_LOAD_ATTEMPTS = 3;
const TRANSACTIONS_FRAME_WAIT_MS = 2000;

/**
 * Checks whether the account selector dropdown is currently open and visible.
 *
 * @param page - the Playwright page to inspect
 * @returns true if the dropdown panel is visible
 */
async function isDropdownOpen(page: Page): Promise<boolean> {
  return page
    .$eval(DROPDOWN_PANEL_SELECTOR, el => {
      return (
        window.getComputedStyle(el).display !== 'none' && (el as HTMLElement).offsetParent !== null
      );
    })
    .catch(() => false);
}

/**
 * Opens the account selector dropdown if it is not already open.
 *
 * @param page - the Playwright page containing the account selector
 * @returns a done result when the dropdown is open
 */
async function ensureDropdownOpen(page: Page): Promise<IDoneResult> {
  if (await isDropdownOpen(page)) return { done: true };
  await waitUntilElementFound(page, ACCOUNT_SELECTOR, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  await clickButton(page, ACCOUNT_SELECTOR);
  await waitUntilElementFound(page, DROPDOWN_PANEL_SELECTOR, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  return { done: true };
}

/**
 * Opens the account selector dropdown and returns all available account labels.
 *
 * @param page - the Playwright page containing the account selector
 * @returns an array of account label strings, or an empty array if the selector is absent
 */
export async function clickAccountSelectorGetAccountIds(page: Page): Promise<string[]> {
  try {
    await ensureDropdownOpen(page);
    const accountLabels = await page.$$eval(OPTION_SELECTOR, options =>
      options.map(option => option.textContent.trim()).filter(label => label !== ''),
    );
    return accountLabels;
  } catch {
    return [];
  }
}

/**
 * Reads account IDs from the legacy select dropdown (old Beinleumi UI).
 *
 * @param page - the Playwright page containing the legacy select element
 * @returns an array of account ID strings from the select options
 */
async function getAccountIdsOldUI(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    return Array.from(options, option => option.value);
  });
}

/**
 * Retrieves all account IDs from either the new dropdown or the legacy select UI.
 *
 * @param page - the Playwright page containing the account selector
 * @returns an array of account ID strings
 */
export async function getAccountIdsBothUIs(page: Page): Promise<string[]> {
  let accountsIds: string[] = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) accountsIds = await getAccountIdsOldUI(page);
  return accountsIds;
}

/**
 * Clicks the dropdown option matching the given account label.
 *
 * @param page - the Playwright page with the open dropdown
 * @param accountLabel - the account label text to match and click
 * @returns true if the matching option was found and clicked, false otherwise
 */
async function clickMatchingOption(page: Page, accountLabel: string): Promise<boolean> {
  const accountOptions = await page.$$(OPTION_SELECTOR);
  const textPromises = accountOptions.map(option =>
    page.evaluate(el => el.textContent.trim(), option),
  );
  const texts = await Promise.all(textPromises);
  const matchIdx = texts.findIndex(text => text === accountLabel);
  if (matchIdx === -1) return false;
  const optionHandle = await accountOptions[matchIdx].evaluateHandle(el => el as HTMLElement);
  await page.evaluate((el: HTMLElement) => {
    el.click();
  }, optionHandle);
  return true;
}

/**
 * Selects an account from the new Angular dropdown by label text.
 *
 * @param page - the Playwright page containing the account selector
 * @param accountLabel - the account label to select
 * @returns true if the account was found and selected, false otherwise
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

/**
 * Attempts to locate the transactions iframe on a single try.
 *
 * @param page - the Playwright page to search for the iframe
 * @param attempt - the current attempt index (0-based) for logging
 * @returns FoundResult wrapping the iframe Frame, or isFound=false when not located
 */
async function tryGetFrameAttempt(page: Page, attempt: number): Promise<FoundResult<Frame>> {
  await sleep(TRANSACTIONS_FRAME_WAIT_MS);
  const iframeEl = await page.$(`#${IFRAME_NAME}`).catch(() => null);
  if (iframeEl) {
    try {
      const frame = await iframeEl.contentFrame();
      if (frame) return { isFound: true, value: frame };
    } catch (e: unknown) {
      LOG.info(e, 'attempt %d: iframe element stale or not an iframe', attempt + 1);
    }
  }
  const byName = page.frames().find(f => f.name() === IFRAME_NAME);
  if (byName) return { isFound: true, value: byName };
  LOG.info(
    'attempt %d/%d: transactions frame not found, retrying...',
    attempt + 1,
    TRANSACTIONS_FRAME_LOAD_ATTEMPTS,
  );
  return { isFound: false };
}

/**
 * Retries finding the transactions iframe up to TRANSACTIONS_FRAME_LOAD_ATTEMPTS times.
 *
 * @param page - the Playwright page containing the iframe
 * @returns FoundResult wrapping the transactions iframe Frame, or isFound=false after all attempts
 */
export async function getTransactionsFrame(page: Page): Promise<FoundResult<Frame>> {
  const attempts = Array.from({ length: TRANSACTIONS_FRAME_LOAD_ATTEMPTS }, (_, i) => i);
  const initial = Promise.resolve<FoundResult<Frame>>({ isFound: false });
  const result = await attempts.reduce(async (prevPromise, attempt) => {
    const found = await prevPromise;
    if (found.isFound) return found;
    return tryGetFrameAttempt(page, attempt);
  }, initial);
  if (!result.isFound)
    LOG.info(
      'getTransactionsFrame: failed to find frame after %d attempts',
      TRANSACTIONS_FRAME_LOAD_ATTEMPTS,
    );
  return result;
}
