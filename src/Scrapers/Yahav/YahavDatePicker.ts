import { type Moment } from 'moment';
import { type Page } from 'playwright-core';

import { clickButton, waitUntilElementFound } from '../../Common/ElementsInteractions.js';
import { runSerial } from '../../Common/Waiting.js';

/** Number of year cells in the date picker grid. */
const YEARS_GRID_SIZE = 12;

/** Number of day cells in the date picker grid. */
const DAYS_GRID_SIZE = 42;

/** Typed selector keys required by the Yahav date picker. */
export interface IYahavDateSelectors {
  datePickerOpener: string;
  daysGridCheck: string;
  daysGridPrefix: string;
  monthPickerBtn: string;
  monthsGridCheck: string;
  monthsGridPrefix: string;
  yearsGridCheck: string;
  yearsGridPrefix: string;
}

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
  const raw = await page.locator(selector).first().innerText();
  if (target !== raw.trim()) return false;
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
  let isClicked = false;
  return Array.from({ length: count }, (_, i): (() => Promise<boolean>) => async () => {
    if (isClicked) return false;
    const sel = `${prefix} > div:nth-child(${String(i + 1)})`;
    const didClick = await tryClickGridCell(page, sel, target);
    if (didClick) isClicked = true;
    return didClick;
  });
}

/**
 * Select a year from the date picker grid.
 * @param page - The Playwright page instance.
 * @param sel - The resolved selectors map.
 * @param targetYear - The year string to select.
 * @returns True if the target year was found and clicked.
 */
async function selectYearFromGrid(
  page: Page,
  sel: IYahavDateSelectors,
  targetYear: string,
): Promise<boolean> {
  const actions = buildGridActions(
    { page, prefix: sel.yearsGridPrefix, target: targetYear },
    YEARS_GRID_SIZE,
  );
  const results = await runSerial(actions);
  return results.some(Boolean);
}

/**
 * Select a day from the date picker grid.
 * @param page - The Playwright page instance.
 * @param sel - The resolved selectors map.
 * @param targetDay - The day string to select.
 * @returns True if the target day was found and clicked.
 */
async function selectDayFromGrid(
  page: Page,
  sel: IYahavDateSelectors,
  targetDay: string,
): Promise<boolean> {
  const actions = buildGridActions(
    { page, prefix: sel.daysGridPrefix, target: targetDay },
    DAYS_GRID_SIZE,
  );
  const results = await runSerial(actions);
  return results.some(Boolean);
}

/**
 * Open the date picker widget.
 * @param page - The Playwright page instance.
 * @param sel - The resolved selectors map.
 * @returns True after the picker is open.
 */
async function openDatePicker(page: Page, sel: IYahavDateSelectors): Promise<boolean> {
  await waitUntilElementFound(page, sel.datePickerOpener, { visible: true });
  await clickButton(page, sel.datePickerOpener);
  await waitUntilElementFound(page, sel.daysGridCheck, { visible: true });
  return true;
}

/**
 * Navigate the date picker to the year/month view.
 * Pickmeup cycles: days → months → years on repeated header clicks.
 * First click opens months grid; second click opens years grid.
 * @param page - The Playwright page instance.
 * @param sel - The resolved selectors map.
 * @returns True after navigation.
 */
async function navigateToYearView(page: Page, sel: IYahavDateSelectors): Promise<boolean> {
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
 * @returns True if all date components were selected successfully.
 */
export default async function searchByDates(
  page: Page,
  startDate: Moment,
  sel: IYahavDateSelectors,
): Promise<boolean> {
  const day = startDate.format('D');
  const month = startDate.format('M');
  const year = startDate.format('Y');
  await openDatePicker(page, sel);
  await navigateToYearView(page, sel);
  const didSelectYear = await selectYearFromGrid(page, sel, year);
  if (!didSelectYear) return false;
  await waitUntilElementFound(page, sel.monthsGridCheck, { visible: true });
  const monthCell = `${sel.monthsGridPrefix} > div:nth-child(${month})`;
  await clickButton(page, monthCell);
  await waitUntilElementFound(page, sel.daysGridCheck, { visible: true });
  return selectDayFromGrid(page, sel, day);
}
