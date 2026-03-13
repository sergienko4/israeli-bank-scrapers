import { type Frame, type Page } from 'playwright';

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
    .evaluate(
      (el: Element) =>
        window.getComputedStyle(el).display !== 'none' && (el as HTMLElement).offsetParent !== null,
    )
    .catch(() => false);
}

/**
 * Ensure the account dropdown is open, clicking the trigger if needed.
 * @param page - The Playwright page instance.
 * @returns True when the dropdown is confirmed open.
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
  return true;
}

/**
 * Open the account dropdown and return all visible account labels.
 * @param page - The Playwright page instance.
 * @returns Array of account label strings.
 */
export async function clickAccountSelectorGetAccountIds(page: Page): Promise<string[]> {
  try {
    await ensureDropdownOpen(page);
    const accountLabels = await page
      .locator(OPTION_SELECTOR)
      .evaluateAll((options: Element[]) =>
        options.map(option => (option.textContent || '').trim()).filter(label => label !== ''),
      );
    return accountLabels;
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
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    return Array.from(options, option => option.value);
  });
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
  const accountOptions = await page.$$(OPTION_SELECTOR);
  const clickTasks = accountOptions.map(async option => {
    const text = await page.evaluate(el => el.textContent.trim(), option);
    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el as HTMLElement);
      await page.evaluate((el: HTMLElement) => {
        el.click();
      }, optionHandle);
      return true;
    }
    return false;
  });
  const results = await Promise.all(clickTasks);
  return results.some(Boolean);
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
 * Try to get a frame from an iframe element handle.
 * @param iframeEl - The element handle for the iframe.
 * @param attempt - Zero-based attempt index for logging.
 * @returns The content frame if available.
 */
async function tryContentFrame(
  iframeEl: Awaited<ReturnType<Page['$']>>,
  attempt: number,
): Promise<OptionalFrame> {
  const noFrame: OptionalFrame = undefined;
  if (!iframeEl) return noFrame;
  try {
    const frame = await iframeEl.contentFrame();
    if (frame) return frame;
  } catch (e: unknown) {
    LOG.debug(e, 'attempt %d: iframe element stale or not an iframe', attempt + 1);
  }
  return noFrame;
}

/**
 * Try a single attempt to locate the transactions iframe.
 * @param page - The Playwright page instance.
 * @param attempt - Zero-based attempt index for logging.
 * @returns The frame if found, or undefined if not yet available.
 */
async function tryGetFrameAttempt(page: Page, attempt: number): Promise<OptionalFrame> {
  await page.waitForTimeout(TRANSACTIONS_FRAME_WAIT_MS);
  const iframeEl = await page.$(`#${IFRAME_NAME}`).catch(() => null);
  const fromElement = await tryContentFrame(iframeEl, attempt);
  if (fromElement) return fromElement;
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
