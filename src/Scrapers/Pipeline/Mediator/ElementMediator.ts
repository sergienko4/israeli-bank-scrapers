/**
 * Element Mediator interface — black-box for ALL HTML resolution.
 * Scrapers describe WHAT they want, Mediator finds HOW.
 *
 * The mediator is the SINGLE entry point for all HTML operations:
 * - Fields (inputs, selects): resolveField
 * - Clickables (submit, OTP trigger, links): resolveClickable
 * - Visibility probe (Identify → Inspect → Act): resolveVisible
 * - Form discovery: discoverForm, scopeToForm
 * - Error detection after submit: discoverErrors
 *
 * Banks NEVER import resolveFieldPipeline, tryInContext, FormErrorDiscovery, etc.
 * LoginSteps NEVER call HTML utilities directly — only through ctx.mediator.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import type { Option } from '../Types/Option.js';
import type { Procedure } from '../Types/Procedure.js';
import type { IFormAnchor } from './FormAnchor.js';
import type { IFormErrorScanResult } from './FormErrorDiscovery.js';
import type { INetworkDiscovery } from './NetworkDiscovery.js';
import type { IFieldContext } from './SelectorResolverPipeline.js';

/** Whether an element race found a visible element. */
type RaceFound = boolean;
/** 0-based index of the winning locator (-1 if not found). */
type WinnerIndex = number;
/** Snapshot text or href captured immediately after winning the race. */
type SnapshotValue = string;

/**
 * Result of a parallel race — what was found, where, and which candidate matched.
 * Returned by resolveVisible for Identify → Inspect → Act pattern.
 * The value field is a snapshot captured immediately to prevent stale-element errors.
 */
interface IRaceResult {
  /** True if an element was found within the timeout. */
  readonly found: RaceFound;
  /** The winning Playwright locator, or false if not found. */
  readonly locator: Locator | false;
  /** Which SelectorCandidate matched, or false if not found. */
  readonly candidate: SelectorCandidate | false;
  /** The Page or Frame where the element was found, or false. */
  readonly context: Page | Frame | false;
  /** Index of the winning locator in the flat array (-1 if not found). */
  readonly index: WinnerIndex;
  /** Snapshot of innerText (or href for target:'href') captured immediately. */
  readonly value: SnapshotValue;
}

/** Constant for "not found" — avoids allocating a new object each time. */
const NOT_FOUND_RESULT: IRaceResult = {
  found: false,
  locator: false,
  candidate: false,
  context: false,
  index: -1 as WinnerIndex,
  value: '',
};

/** High-level element resolution — scrapers describe intent, Mediator resolves. */
interface IElementMediator {
  /**
   * Resolve an input field by credential key.
   * If scopeContext provided: searches ONLY that iframe/frame first (scoped).
   * Falls back to searching all iframes if scoped search fails or no scope.
   * Returns IFieldContext including the frame context where element was found.
   * @param fieldKey - The credential key (e.g., 'username', 'password').
   * @param candidates - Bank-specific selector candidates (can be empty).
   * @param scopeContext - Optional: iframe/frame where a previous field was found.
   */
  resolveField(
    fieldKey: string,
    candidates: readonly SelectorCandidate[],
    scopeContext?: Page | Frame,
    formSelector?: string,
  ): Promise<Procedure<IFieldContext>>;

  /**
   * Resolve a clickable element (submit button, OTP trigger, link).
   * Searches main page and all child iframes automatically.
   * Returns IFieldContext so the caller can click in the correct frame context.
   */
  resolveClickable(candidates: readonly SelectorCandidate[]): Promise<Procedure<IFieldContext>>;

  /**
   * Discover form validation errors in the given frame after submit.
   * Runs Layer 1 (DOM structural scan) then Layer 2 (WellKnown text) if needed.
   * Pass the activeFrame so iframe forms (e.g. VisaCal connect) are scanned correctly.
   */
  discoverErrors(frame: Page | Frame): Promise<IFormErrorScanResult>;

  /**
   * Wait for loading indicators to disappear from the given frame.
   * Uses WellKnown loadingIndicator candidates. Retries up to 2 times with 2s delay.
   * Generic — works for any bank after form submit, OTP, or dashboard navigation.
   * @param frame - The Page or Frame to monitor.
   * @returns Procedure succeed(true) when done, fail on infrastructure error.
   */
  waitForLoadingDone(frame: Page | Frame): Promise<Procedure<true>>;

  /**
   * Resolve the first visible element WITHOUT clicking. Returns metadata for inspection.
   * Parallel race across main page + iframes. Captures a value snapshot immediately.
   * Use this for Identify → Inspect → Act: find element, check href/text, then decide.
   * @param candidates - WellKnown selector candidates to try.
   * @param timeoutMs - Optional custom timeout (default: CLICK_RACE_TIMEOUT).
   * @returns IRaceResult with locator, candidate, context, and snapshot value.
   */
  resolveVisible(
    candidates: readonly SelectorCandidate[],
    timeoutMs?: number,
  ): Promise<IRaceResult>;

  /**
   * Resolve a clickable element and click it via Procedure.
   * Uses the resolver's text→walk-up-to-interactive-ancestor pipeline.
   * Internally calls resolveVisible then clicks the winner.
   * @param candidates - WellKnown selector candidates to try.
   * @param timeoutMs - Optional custom timeout (default: CLICK_RACE_TIMEOUT).
   * @returns Procedure with IRaceResult (found=true if clicked, found=false if not found).
   */
  resolveAndClick(
    candidates: readonly SelectorCandidate[],
    timeoutMs?: number,
  ): Promise<Procedure<IRaceResult>>;

  /** Discover and cache the form anchor from a resolved field. */
  discoverForm(resolvedContext: IFieldContext): Promise<Option<IFormAnchor>>;

  /** Scope candidates to the cached form anchor. */
  scopeToForm(candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[];

  /** Network discovery — captures API traffic from browser page. */
  readonly network: INetworkDiscovery;

  /**
   * Navigate to a URL. Wraps page.goto().
   * Navigation errors are terminal — homepage unreachable = stop.
   * @param url - Target URL.
   * @param opts - Playwright goto options.
   * @param opts.waitUntil - Load event to wait for.
   * @param opts.timeout - Navigation timeout in ms.
   * @returns Succeed or fail with error message.
   */
  navigateTo(
    url: string,
    opts?: { waitUntil?: 'domcontentloaded' | 'load' | 'networkidle'; timeout?: number },
  ): Promise<Procedure<void>>;

  /**
   * Get current page URL. SYNCHRONOUS — page.url() is sync in Playwright.
   * Call AFTER waitForNetworkIdle to get the final URL, not a redirect intermediate.
   * @returns Current page URL string.
   */
  getCurrentUrl(): string;

  /**
   * Wait for network to settle. Timeout is non-fatal.
   * A slow analytics script should not kill the scraper.
   * @param timeoutMs - Max wait time (default: 15000ms).
   * @returns Always succeed — timeout is swallowed.
   */
  waitForNetworkIdle(timeoutMs?: number): Promise<Procedure<void>>;

  /**
   * Count elements matching visible text. Returns 0 on error.
   * Wraps page.getByText(text).first().count() with catch → 0.
   * @param text - Visible text to search for.
   * @returns Element count (0 if not found or error).
   */
  countByText(text: string): Promise<number>;

  /**
   * Collect all absolute href values from anchor elements on the page.
   * Read-only extraction — no interaction. Structural CSS allowed per CLAUDE.md.
   * @returns Deduplicated absolute href strings.
   */
  collectAllHrefs(): Promise<readonly string[]>;
}

export default IElementMediator;
export { NOT_FOUND_RESULT };
export type { IElementMediator, IRaceResult, RaceFound, SnapshotValue, WinnerIndex };
