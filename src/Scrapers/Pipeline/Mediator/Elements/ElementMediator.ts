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

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import type { Option } from '../../Types/Option.js';
import type { ContextId } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';
import type { IFormErrorScanResult } from '../Form/FormErrorDiscovery.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscovery.js';
import type { IFieldContext } from '../Selector/SelectorResolverPipeline.js';

/** Whether an element race found a visible element. */
type RaceFound = boolean;
/** 0-based index of the winning locator (-1 if not found). */
type WinnerIndex = number;
/** Snapshot text or href captured immediately after winning the race. */
type SnapshotValue = string;
/** Current page URL returned by mediator. */
type CurrentPageUrl = string;
/** Whether an HTML attribute was found on the element. */
type HasAttribute = boolean;
/** Whether the URL matched the expected pattern after navigation. */
type DidNavigate = boolean;
/** CSS/XPath selector string for form fields. */
type FieldSelector = string;
/** Input value string for form filling. */
type FieldValue = string;
/** Whether a WK transaction-shaped endpoint has been captured. */
type IsTxnFound = boolean;

/**
 * Structured DOM identity captured during PRE resolution.
 * Carries every stable attribute the ACTION stage might use to build a
 * precise click/fill selector (so we don't have to re-derive from the
 * original WK candidate's `kind` after the element has been resolved).
 * Sentinel string `(none)` is used for absent attributes so the type
 * stays a plain string and consumers can do simple string-equality checks.
 */
interface IElementIdentity {
  readonly tag: string;
  readonly id: string;
  readonly classes: string;
  readonly name: string;
  readonly type: string;
  readonly ariaLabel: string;
  readonly title: string;
  readonly href: string;
}

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
  /** Resolved element's actual DOM identity — id, name, aria-label, title, href.
   *  Used by ACTION to build a precise selector that matches the exact element
   *  PRE found, instead of re-deriving from the original WK candidate kind. */
  readonly identity: IElementIdentity | false;
}

/** Constant for "not found" — avoids allocating a new object each time. */
const NOT_FOUND_RESULT: IRaceResult = {
  found: false,
  locator: false,
  candidate: false,
  context: false,
  index: -1 as WinnerIndex,
  value: '',
  identity: false,
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
   * Resolve UP TO `cap` visible elements without clicking. Same parallel
   * race as `resolveVisible`, but instead of returning only the first
   * winner this returns the top-N fulfilled candidates in DOM order.
   * Used by phases that opt into BasePhase's ACTION-retry loop (e.g.
   * DASHBOARD): PRE pre-fetches the candidate list once, ACTION clicks
   * `candidates[attempt]` per iteration. Returns an empty array when
   * nothing fulfilled within the timeout.
   * @param candidates - WellKnown selector candidates to try.
   * @param timeoutMs - Race timeout (default: CLICK_RACE_TIMEOUT).
   * @param cap - Maximum number of results to return (≥ 1).
   * @returns Up to `cap` IRaceResult entries, may be shorter or empty.
   */
  resolveAllVisible(
    candidates: readonly SelectorCandidate[],
    timeoutMs: number,
    cap: number,
  ): Promise<readonly IRaceResult[]>;

  /**
   * Resolve a visible element within a SPECIFIC frame context only.
   * Used when the search must be scoped (e.g. OTP submit in same frame as OTP input).
   * @param candidates - WellKnown selector candidates to try.
   * @param context - The specific Page or Frame to search in.
   * @param timeoutMs - Optional custom timeout.
   * @returns IRaceResult scoped to the given context.
   */
  resolveVisibleInContext(
    candidates: readonly SelectorCandidate[],
    context: Page | Frame,
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
   * Set the currently active pipeline phase — called by BasePhase.run().
   * Generic mediator methods read this to log the correct phase name.
   * @param name - Phase name (init, home, login, dashboard, scrape, etc).
   * @returns True after setting.
   */
  setActivePhase(name: string): true;

  /**
   * Set the currently active pipeline stage — called by BasePhase.run() before each stage.
   * Generic mediator methods read this to log the correct stage name.
   * @param name - Stage name (PRE, ACTION, POST, FINAL).
   * @returns True after setting.
   */
  setActiveStage(name: 'PRE' | 'ACTION' | 'POST' | 'FINAL'): true;

  /**
   * Get current page URL. SYNCHRONOUS — page.url() is sync in Playwright.
   * Call AFTER waitForNetworkIdle to get the final URL, not a redirect intermediate.
   * @returns Current page URL string.
   */
  getCurrentUrl(): CurrentPageUrl;

  /**
   * Wait for network to settle. Timeout is non-fatal.
   * A slow analytics script should not kill the scraper.
   * @param timeoutMs - Max wait time (default: 15000ms).
   * @returns Always succeed — timeout is swallowed.
   */
  waitForNetworkIdle(timeoutMs?: number): Promise<Procedure<void>>;

  /**
   * Wait for URL to match a glob pattern (SPA navigation wait).
   * Non-fatal: returns succeed(false) on timeout.
   * @param pattern - Glob pattern (e.g. '**\/login**').
   * @param timeoutMs - Max wait time (default: 10000ms).
   * @returns Procedure with true if URL matched, false on timeout.
   */
  waitForURL(pattern: string, timeoutMs?: number): Promise<Procedure<DidNavigate>>;

  /**
   * Count elements matching visible text. Returns 0 on error.
   * Wraps page.getByText(text).first().count() with catch → 0.
   * @param text - Visible text to search for.
   * @returns Element count (0 if not found or error).
   */
  countByText(text: string): Promise<number>;

  /**
   * Check if a resolved element has a specific HTML attribute (passive, no click).
   * Used by HOME.PRE to detect toggle vs navigation link (href presence).
   * @param result - The resolved race result from resolveVisible.
   * @param attrName - The HTML attribute to check (e.g. 'href').
   * @returns Procedure with true if attribute exists and is non-empty.
   */
  checkAttribute(result: IRaceResult, attrName: string): Promise<Procedure<HasAttribute>>;

  /**
   * Get the raw value of an HTML attribute on a resolved element (passive).
   * Used by HOME.PRE to read href value for navigation vs modal detection.
   * @param result - The resolved race result from resolveVisible.
   * @param attrName - The HTML attribute to read (e.g. 'href').
   * @returns The attribute value string, or empty if not found.
   */
  getAttributeValue(result: IRaceResult, attrName: string): Promise<string>;

  /**
   * Collect all absolute href values from anchor elements on the page.
   * Read-only extraction — no interaction. Structural CSS allowed per CLAUDE.md.
   * @returns Deduplicated absolute href strings.
   */
  collectAllHrefs(): Promise<readonly string[]>;

  /**
   * Get all cookies from the browser context.
   * Used by LOGIN.SIGNAL to audit session establishment.
   * @returns Array of cookie objects with name, domain, value.
   */
  getCookies(): Promise<readonly ICookieSnapshot[]>;

  /**
   * Add cookies to the browser context — used for cross-domain session promotion.
   * @param cookies - Array of cookie objects to inject.
   */
  addCookies(cookies: readonly ICookieInjection[]): Promise<void>;
}

/** Cookie snapshot from browser context (getCookies). */
interface ICookieSnapshot {
  readonly name: CookieLabel;
  readonly domain: CookieLabel;
  readonly value: CookieLabel;
}

/** Cookie injection shape (addCookies) — includes path. */
interface ICookieInjection {
  readonly name: CookieLabel;
  readonly value: CookieLabel;
  readonly domain: CookieLabel;
  readonly path: CookieLabel;
}

/** Opaque cookie field (name, domain, value, or path). */
type CookieLabel = string;

/** Bundled args for `IActionMediator.clickElement` — fits the 3-param ceiling. */
interface IClickElementArgs {
  /** Opaque frame identifier. */
  readonly contextId: ContextId;
  /** CSS/XPath selector. */
  readonly selector: FieldSelector;
  /** Force click bypassing actionability checks (for hidden toggles). */
  readonly isForce?: boolean;
  /** Optional 0-based nth index when the selector matches multiple DOM
   *  elements (Beinleumi legacy + modern buttons share aria-label).
   *  Default `.first()` (== `.nth(0)`); ACTION-level iteration provides
   *  i = 0..N-1 via `dashboardCandidateCount`. */
  readonly nth?: number;
}

// ── Action-Only Mediator — the ONLY browser window during ACTION ─────

/**
 * Sealed executor interface for ACTION stage.
 * NO resolveField, resolveVisible, discoverForm, resolveClickable.
 * The compiler rejects any discovery call through this interface.
 */
interface IActionMediator {
  // ── Form execution (contextId-based, private Frame resolution) ──

  /**
   * Fill an input field by contextId + selector.
   * @param contextId - Opaque frame identifier from PRE discovery.
   * @param selector - CSS/XPath selector for the input.
   * @param value - Value to fill.
   * @returns True after filling.
   */
  fillInput(contextId: ContextId, selector: FieldSelector, value: FieldValue): Promise<true>;

  /**
   * Click an element by contextId + selector.
   * @param args - Bundled click arguments (contextId + selector + isForce + nth).
   * @returns True after clicking.
   */
  clickElement(args: IClickElementArgs): Promise<true>;

  /**
   * Press Enter in the specified frame context.
   * @param contextId - Opaque frame identifier.
   * @returns True after pressing.
   */
  pressEnter(contextId: ContextId): Promise<true>;

  // ── Navigation (no raw Frame needed) ──

  /** Navigate to URL. */
  navigateTo(
    url: FieldSelector,
    opts?: { waitUntil?: 'domcontentloaded' | 'load' | 'networkidle'; timeout?: number },
  ): Promise<Procedure<void>>;
  /** Wait for network idle. */
  waitForNetworkIdle(timeoutMs?: number): Promise<Procedure<void>>;
  /** Wait for URL pattern match. */
  waitForURL(pattern: FieldSelector, timeoutMs?: number): Promise<Procedure<DidNavigate>>;
  /** Get current page URL. */
  getCurrentUrl(): CurrentPageUrl;

  // ── Cookie/State (no raw Frame needed) ──

  /** Get cookies. */
  getCookies(): Promise<readonly ICookieSnapshot[]>;
  /** Add cookies. */
  addCookies(cookies: readonly ICookieInjection[]): Promise<void>;
  /** Count elements by text. */
  countByText(text: FieldSelector): Promise<number>;
  /** Collect all hrefs. */
  collectAllHrefs(): Promise<readonly string[]>;
  /** Collect sessionStorage key-value pairs. */
  collectStorage(): Promise<Readonly<Record<FieldSelector, FieldSelector>>>;

  /** Read-only check: has a WK transaction-shaped endpoint been captured
   *  in the network discovery so far? Single narrow method for ACTION-stage
   *  callers that need to verify a click had real txn-traffic effect (e.g.
   *  Beinleumi pm.q077 BFF detection). NOT a full discovery surface. */
  hasTxnEndpoint(): IsTxnFound;

  /** Event-driven wait for a WK transaction-shaped endpoint to be captured
   *  (wraps Playwright `page.waitForResponse`). Used by DASHBOARD ACTION
   *  after a successful URL-pattern match: Angular SPAs (Beinleumi pm.q077,
   *  Discount) navigate to `/transactions` BEFORE the BFF XHR fires, so we
   *  must wait for that XHR to be observable to SCRAPE.PRE's autoScrape.
   *  Returns immediately if already captured. Non-fatal on timeout.
   *  @param timeoutMs - Max wait budget.
   *  @returns True if captured (now or already), false on timeout. */
  waitForTxnEndpoint(timeoutMs: number): Promise<IsTxnFound>;

  // ── REMOVED: setActivePhase, setActiveStage, full network discovery ──
  // BasePhase.run() is the SOLE authority for stage transitions.
  // Discovery (resolveField, etc.) belongs in PRE, not ACTION.
}

export default IElementMediator;
export type {
  CookieLabel,
  IActionMediator,
  IClickElementArgs,
  ICookieInjection,
  ICookieSnapshot,
  IElementIdentity,
  IElementMediator,
  IRaceResult,
  IsTxnFound,
  RaceFound,
  SnapshotValue,
  WinnerIndex,
};
export { NOT_FOUND_RESULT };
