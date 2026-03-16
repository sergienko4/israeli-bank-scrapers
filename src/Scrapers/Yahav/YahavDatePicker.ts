import { type Moment } from 'moment';
import { type Page } from 'playwright-core';

import { clickButton, waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import { runSerial } from '../../Common/Waiting.js';

/** Resolved selectors object type. */
type SelMap = Record<string, string>;

interface IGridOpts {
  page: Page;
  prefix: string;
  target: string;
}

/**
 * Try clicking a grid cell that matches the target text.
 * @param page - The Playwright page instance.
 * @param selector - The CSS selector for the cell.
 * @param target - The target text to match.
 * @returns True if the cell was clicked, false otherwise.
 */
async function tryClickGridCell(page: Page, selector: string, target: string): Promise<boolean> {
  const text = await page.locator(selector).first().innerText();
  if (target !== text) return false;
  await clickButton(page, selector);
  return true;
}

/**
 * Build grid-click actions for a range of child elements.
 * @param opts - Grid options with page, prefix, and target.
 * @param count - The number of child elements to check.
 * @returns Array of action functions.
 */
function buildGridActions(opts: IGridOpts, count: number): (() => Promise<boolean>)[] {
  const { page, prefix, target } = opts;
  return Array.from(
    { length: count },
    (_, i): (() => Promise<boolean>) =>
      () =>
        tryClickGridCell(page, `${prefix} > div:nth-child(${String(i + 1)})`, target),
  );
}

/**
 * Select a year from the date picker grid.
 * @param page - The Playwright page instance.
 * @param targetYear - The year string to select.
 * @returns True after selection.
 */
async function selectYearFromGrid(page: Page, targetYear: string): Promise<boolean> {
  const actions = buildGridActions({ page, prefix: '.pmu-years', target: targetYear }, 12);
  await runSerial(actions);
  return true;
}

/**
 * Select a day from the date picker grid.
 * @param page - The Playwright page instance.
 * @param targetDay - The day string to select.
 * @returns True after selection.
 */
async function selectDayFromGrid(page: Page, targetDay: string): Promise<boolean> {
  const actions = buildGridActions({ page, prefix: '.pmu-days', target: targetDay }, 41);
  await runSerial(actions);
  return true;
}

/**
 * Open the date picker widget.
 * @param page - The Playwright page instance.
 * @param sel - The resolved selectors map.
 * @returns True after the picker is open.
 */
async function openDatePicker(page: Page, sel: SelMap): Promise<boolean> {
  await waitUntilElementFound(page, sel.datePickerOpener, { visible: true });
  await clickButton(page, sel.datePickerOpener);
  await waitUntilElementFound(page, '.pmu-days > div:nth-child(1)', { visible: true });
  return true;
}

/**
 * Navigate the date picker to the year/month view.
 * @param page - The Playwright page instance.
 * @param sel - The resolved selectors map.
 * @returns True after navigation.
 */
async function navigateToYearView(page: Page, sel: SelMap): Promise<boolean> {
  await waitUntilElementFound(page, sel.monthPickerBtn, { visible: true });
  await clickButton(page, sel.monthPickerBtn);
  await waitUntilElementFound(page, sel.monthsGridCheck, { visible: true });
  await waitUntilElementFound(page, sel.monthPickerBtn, { visible: true });
  await clickButton(page, sel.monthPickerBtn);
  await waitUntilElementFound(page, sel.yearsGridCheck, { visible: true });
  return true;
}

/**
 * Search transactions by start date using the date picker.
 * @param page - The Playwright page instance.
 * @param startDate - The start date for filtering.
 * @param sel - The resolved selectors map.
 * @returns True after search is applied.
 */
export default async function searchByDates(
  page: Page,
  startDate: Moment,
  sel: SelMap,
): Promise<boolean> {
  const day = startDate.format('D');
  const month = startDate.format('M');
  const year = startDate.format('Y');
  await openDatePicker(page, sel);
  await navigateToYearView(page, sel);
  await selectYearFromGrid(page, year);
  await waitUntilElementFound(page, sel.monthsGridCheck, { visible: true });
  await clickButton(page, `.pmu-months > div:nth-child(${month})`);
  await selectDayFromGrid(page, day);
  return true;
}
