/**
 * SEQUENTIAL menu→child navigation helpers for DASHBOARD PRE.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}
 * carrying the Max-specific menu-toggle-then-child probe + selector
 * builders. Split out so the parent file stays under the LoC cap.
 *
 * <p>Cross-bank-safe: probe returns `false` for any bank whose
 * dashboard doesn't render an Angular `[dropdowntoggle]` directive
 * matching a WK_DASHBOARD.MENU_EXPAND text candidate AND a
 * WK_TRANSACTIONS exactText candidate present in the DOM.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { IResolvedTarget } from '../../Types/PipelineContext.js';
import { candidateToSelector } from '../Elements/ActionExecutors.js';
import { NO_HREF } from './DashboardDiscovery.js';
import type { IDashboardTargets } from './DashboardPhaseActions.targets.types.js';

/** Main-frame context identifier — matches FrameRegistry.MAIN_CONTEXT_ID. */
const MAIN_CONTEXT_ID = 'main';

/**
 * Angular `dropdowntoggle` directive — the deterministic structural signal
 * for a real dropdown-toggle. Always present when the directive is bound,
 * unlike `role="button"` which Angular hydrates inconsistently across runs.
 */
const DROPDOWN_TOGGLE_ARIA_FILTER = '[dropdowntoggle]';

/**
 * Defensive wrapper around `page.getByText(...).count()` — sync exceptions
 * thrown by mock pages (no `getByText` method) coerce to a 0 count instead
 * of crashing the SEQUENTIAL probe.
 * @param page - Browser page.
 * @param value - Exact-text value to count.
 * @returns DOM match count (0 on error).
 */
async function safeProbeExactTextCount(page: Page, value: string): Promise<number> {
  try {
    return await page.getByText(value, { exact: true }).count();
  } catch {
    return 0;
  }
}

/**
 * Probe ONE WK candidate via the exact-text count helper. Returns 0
 * for any non-`exactText` candidate kind so the parent's
 * `Promise.all(...)` projection stays single-call per element.
 * @param page - Browser page.
 * @param c - Candidate to probe.
 * @returns DOM match count (0 when kind is not exactText).
 */
function probeExactTextCandidate(page: Page, c: SelectorCandidate): Promise<number> {
  if (c.kind !== 'exactText') return Promise.resolve(0);
  return safeProbeExactTextCount(page, c.value);
}

/**
 * Find the first exactText candidate from WK_TRANSACTIONS that has at least
 * one DOM match on the current page. Used as the SEQUENTIAL-fire signal —
 * exactText entries are bank-specific disambiguators.
 * @param page - Browser page.
 * @param candidates - WK_TRANSACTIONS list.
 * @returns First exactText candidate present in DOM, or false.
 */
async function findFirstChildInDom(
  page: Page,
  candidates: readonly SelectorCandidate[],
): Promise<SelectorCandidate | false> {
  const probes = candidates.map((c): Promise<number> => probeExactTextCandidate(page, c));
  const counts = await Promise.all(probes);
  const idx = counts.findIndex((n): boolean => n >= 1);
  if (idx < 0) return false;
  return candidates[idx];
}

/**
 * Defensive wrapper around `page.locator([dropdowntoggle]).filter().count()`
 * — sync exceptions thrown by mock pages coerce to a 0 count instead of
 * crashing the SEQUENTIAL probe.
 * @param page - Browser page.
 * @param value - hasText value to filter by.
 * @returns DOM match count (0 on error).
 */
async function safeProbeDropdownToggleCount(page: Page, value: string): Promise<number> {
  try {
    return await page.locator(DROPDOWN_TOGGLE_ARIA_FILTER).filter({ hasText: value }).count();
  } catch {
    return 0;
  }
}

/**
 * Probe ONE WK candidate via the dropdown-toggle count helper. Returns
 * 0 for any non-text candidate kind so the parent's `Promise.all(...)`
 * projection stays single-call per element.
 * @param page - Browser page.
 * @param c - Candidate to probe.
 * @returns DOM match count (0 when kind is not text-based).
 */
function probeDropdownToggleCandidate(page: Page, c: SelectorCandidate): Promise<number> {
  if (c.kind !== 'textContent' && c.kind !== 'exactText') return Promise.resolve(0);
  return safeProbeDropdownToggleCount(page, c.value);
}

/**
 * Find the first WK_MENU_EXPAND text candidate that uniquely matches a
 * dropdown-toggle on the page (Angular `dropdowntoggle` directive filter).
 * @param page - Browser page.
 * @param candidates - WK_MENU_EXPAND list.
 * @returns First matching candidate text, or false.
 */
async function findDropdownToggleCandidate(
  page: Page,
  candidates: readonly SelectorCandidate[],
): Promise<SelectorCandidate | false> {
  const probes = candidates.map((c): Promise<number> => probeDropdownToggleCandidate(page, c));
  const counts = await Promise.all(probes);
  const idx = counts.indexOf(1);
  if (idx < 0) return false;
  return candidates[idx];
}

/**
 * Build a selector that targets the dropdown-toggle uniquely:
 *   `[dropdowntoggle]:has-text("<value>")`
 * Combines the WK candidate text with the Angular directive filter.
 * @param value - Visible text of the dropdown-toggle.
 * @returns Playwright-compatible selector string.
 */
function buildDropdownToggleSelector(value: string): string {
  return DROPDOWN_TOGGLE_ARIA_FILTER + ':has-text("' + value + '")';
}

/**
 * Build the menu trigger `IResolvedTarget` for the SEQUENTIAL menu →
 * child chain.
 * @param triggerCandidate - Menu-expand candidate text.
 * @returns Menu IResolvedTarget targeting the dropdown-toggle.
 */
function buildSequentialMenuTarget(triggerCandidate: SelectorCandidate): IResolvedTarget {
  return {
    selector: buildDropdownToggleSelector(triggerCandidate.value),
    contextId: MAIN_CONTEXT_ID,
    kind: 'css',
    candidateValue: triggerCandidate.value,
  };
}

/**
 * Build the child-click `IResolvedTarget` for the SEQUENTIAL chain.
 * @param childCandidate - Selector candidate for the child link.
 * @returns IResolvedTarget for the child click.
 */
function buildSequentialChildTarget(childCandidate: SelectorCandidate): IResolvedTarget {
  return {
    selector: candidateToSelector(childCandidate),
    contextId: MAIN_CONTEXT_ID,
    kind: childCandidate.kind,
    candidateValue: childCandidate.value,
  };
}

/** Bundled targets for {@link assembleSequentialTargets}. */
interface IAssembleSequentialArgs {
  readonly menuTarget: IResolvedTarget;
  readonly childTarget: IResolvedTarget;
}

/**
 * Assemble the SEQUENTIAL targets bundle from the resolved menu +
 * child sub-targets.
 * @param targets - Bundled menu trigger + child-click targets.
 * @returns Dashboard targets bundle for ACTION.
 */
function assembleSequentialTargets(targets: IAssembleSequentialArgs): IDashboardTargets {
  return {
    hrefTarget: NO_HREF,
    clickTarget: targets.childTarget,
    fallbackSelector: NO_HREF,
    clickCandidateCount: 0,
    menuTarget: targets.menuTarget,
  };
}

/**
 * Probe the SEQUENTIAL child candidate (a WK_TRANSACTIONS exactText that
 * exists in the DOM).
 * @param page - Browser page.
 * @returns Matching candidate or false when no WK_TRANSACTIONS entry exists.
 */
function probeSequentialChild(page: Page): Promise<SelectorCandidate | false> {
  const txnWk = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  return findFirstChildInDom(page, txnWk);
}

/**
 * Probe the SEQUENTIAL menu trigger (a real role=button + aria-haspopup
 * dropdown toggle from WK_MENU_EXPAND).
 * @param page - Browser page.
 * @returns Matching candidate or false when no toggle matches.
 */
function probeSequentialTrigger(page: Page): Promise<SelectorCandidate | false> {
  const menuWk = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];
  return findDropdownToggleCandidate(page, menuWk);
}

/**
 * Detect the SEQUENTIAL menu-toggle-then-child pattern on the dashboard.
 * Fires when a child exactText AND a real dropdown-toggle text are both
 * present. Falls through (returns false) when either is missing.
 * @param page - Browser page.
 * @returns Populated targets when SEQUENTIAL detected, else false.
 */
async function tryDashboardSequentialNav(page: Page): Promise<IDashboardTargets | false> {
  const childCandidate = await probeSequentialChild(page);
  if (!childCandidate) return false;
  const triggerCandidate = await probeSequentialTrigger(page);
  if (!triggerCandidate) return false;
  const menuTarget = buildSequentialMenuTarget(triggerCandidate);
  const childTarget = buildSequentialChildTarget(childCandidate);
  return assembleSequentialTargets({ menuTarget, childTarget });
}

export {
  buildDropdownToggleSelector,
  findDropdownToggleCandidate,
  findFirstChildInDom,
  MAIN_CONTEXT_ID,
  safeProbeDropdownToggleCount,
  safeProbeExactTextCount,
  tryDashboardSequentialNav,
};
