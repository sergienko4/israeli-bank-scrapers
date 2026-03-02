import { type Frame, type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { clickButton, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { sleep } from '../../Common/Waiting';

const LOG = getDebug('beinleumi-account-selector');

const ACCOUNT_SELECTOR = 'div.current-account';
const DROPDOWN_PANEL_SELECTOR = 'div.mat-mdc-autocomplete-panel.account-select-dd';
const OPTION_SELECTOR = 'mat-option .mdc-list-item__primary-text';

const ELEMENT_RENDER_TIMEOUT_MS = 10000;
const IFRAME_NAME = 'iframe-old-pages';
const TRANSACTIONS_FRAME_LOAD_ATTEMPTS = 3;
const TRANSACTIONS_FRAME_WAIT_MS = 2000;

async function isDropdownOpen(page: Page): Promise<boolean> {
  return page
    .$eval(DROPDOWN_PANEL_SELECTOR, el => {
      return (
        window.getComputedStyle(el).display !== 'none' && (el as HTMLElement).offsetParent !== null
      );
    })
    .catch(() => false);
}

async function ensureDropdownOpen(page: Page): Promise<void> {
  if (await isDropdownOpen(page)) return;
  await waitUntilElementFound(page, ACCOUNT_SELECTOR, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
  await clickButton(page, ACCOUNT_SELECTOR);
  await waitUntilElementFound(page, DROPDOWN_PANEL_SELECTOR, {
    visible: true,
    timeout: ELEMENT_RENDER_TIMEOUT_MS,
  });
}

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

async function getAccountIdsOldUI(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    return Array.from(options, option => option.value);
  });
}

export async function getAccountIdsBothUIs(page: Page): Promise<string[]> {
  let accountsIds: string[] = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) accountsIds = await getAccountIdsOldUI(page);
  return accountsIds;
}

async function clickMatchingOption(page: Page, accountLabel: string): Promise<boolean> {
  const accountOptions = await page.$$(OPTION_SELECTOR);
  for (const option of accountOptions) {
    const text = await page.evaluate(el => el.textContent.trim(), option);
    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el as HTMLElement);
      await page.evaluate((el: HTMLElement) => {
        el.click();
      }, optionHandle);
      return true;
    }
  }
  return false;
}

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

async function tryGetFrameAttempt(page: Page, attempt: number): Promise<Frame | null> {
  await sleep(TRANSACTIONS_FRAME_WAIT_MS);
  const iframeEl = await page.$(`#${IFRAME_NAME}`).catch(() => null);
  if (iframeEl) {
    try {
      const frame = await iframeEl.contentFrame();
      if (frame) return frame;
    } catch (e: unknown) {
      LOG.info(e, 'attempt %d: iframe element stale or not an iframe', attempt + 1);
    }
  }
  const byName = page.frames().find(f => f.name() === IFRAME_NAME);
  if (byName) return byName;
  LOG.info(
    'attempt %d/%d: transactions frame not found, retrying...',
    attempt + 1,
    TRANSACTIONS_FRAME_LOAD_ATTEMPTS,
  );
  return null;
}

export async function getTransactionsFrame(page: Page): Promise<Frame | null> {
  for (let attempt = 0; attempt < TRANSACTIONS_FRAME_LOAD_ATTEMPTS; attempt++) {
    const frame = await tryGetFrameAttempt(page, attempt);
    if (frame) return frame;
  }
  LOG.info(
    'getTransactionsFrame: failed to find frame after %d attempts',
    TRANSACTIONS_FRAME_LOAD_ATTEMPTS,
  );
  return null;
}
