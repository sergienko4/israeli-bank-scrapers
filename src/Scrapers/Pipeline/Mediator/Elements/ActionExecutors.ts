/**
 * Action-stage executors — fill, click, pressEnter, target resolution.
 * Used by IActionMediator closure. Zero discovery capability.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { getDebug } from '../../Types/Debug.js';
import type { ContextId, IResolvedTarget } from '../../Types/PipelineContext.js';
import { humanDelay } from '../Timing/Waiting.js';

const LOG = getDebug(import.meta.url);

import type { IElementIdentity, IRaceResult } from './ElementMediator.js';
import { deepFillInput } from './ElementsInputActions.js';
import { computeContextId } from './FrameRegistry.js';

/** Timeout for click actions (ms). */
const CLICK_TIMEOUT_MS = 15_000;
/** Max chars of outerHTML to surface in click forensics (forensic snippet). */
const CLICK_OUTER_HTML_MAX = 300;
/** Cap for the forensics evaluate — short so we never add real latency.
 *  If a locator can't resolve in 1.5s, drop to UNKNOWN sentinel and let the
 *  real click proceed with its own 15s timeout. */
const FORENSICS_EVAL_TIMEOUT_MS = 1_500;

/** CSS/XPath selector string. */
type SelectorStr = string;
/** Input value string. */
type ValueStr = string;
/** Whether an identity attribute is a real, non-empty value. */
type IsAttrPresent = boolean;
/** URL string captured from page or frame. */
type UrlStr = string;
/** Tier label identifying which click strategy succeeded/failed. */
type TierLabel = 'force-1' | 'natural-1' | 'dispatch-2' | 'evaluate-3' | 'aria-4';

/** Forensic snapshot of a click target — captured BEFORE the click fires. */
interface IClickForensics {
  readonly preClickUrl: UrlStr;
  readonly clickedTag: string;
  readonly clickedDomId: string;
  readonly clickedClasses: string;
  readonly clickedAttrs: {
    readonly name: string;
    readonly type: string;
    readonly ariaLabel: string;
    readonly title: string;
    readonly href: string;
  };
  readonly clickedOuterHtml: string;
}

/** Sentinel forensics for failures — keeps log shape stable. */
const UNKNOWN_FORENSICS: IClickForensics = {
  preClickUrl: '?',
  clickedTag: '?',
  clickedDomId: '?',
  clickedClasses: '?',
  clickedAttrs: { name: '?', type: '?', ariaLabel: '?', title: '?', href: '?' },
  clickedOuterHtml: '?',
};

/**
 * Capture pre-click forensics: page URL + clicked element identity + outerHTML.
 * Always runs (never gated by env) so CI-vs-LOCAL diffs can prove same-element
 * was clicked. The locator is evaluated in-place — same element the click
 * tier will hit moments later. Returns a sentinel on evaluate failure (e.g.
 * detached node, frame teardown) so the click path proceeds uninterrupted.
 * @param locator - The Playwright locator about to be clicked.
 * @param frame - Page or Frame the locator binds to (for URL capture).
 * @returns Forensic snapshot bundled for the post-click log emit.
 */
async function captureClickForensics(
  locator: Locator,
  frame: Page | Frame,
): Promise<IClickForensics> {
  const preClickUrl = frameUrl(frame);
  return locator
    .evaluate(
      (el: Element, max: number): IClickForensics => ({
        preClickUrl: '',
        clickedTag: el.tagName,
        clickedDomId: el.id || '(none)',
        clickedClasses: el.className || '(none)',
        clickedAttrs: {
          name: el.getAttribute('name') ?? '(none)',
          type: el.getAttribute('type') ?? '(none)',
          ariaLabel: el.getAttribute('aria-label') ?? '(none)',
          title: el.getAttribute('title') ?? '(none)',
          href: el.getAttribute('href') ?? '(none)',
        },
        clickedOuterHtml: (el.outerHTML || '').slice(0, max),
      }),
      CLICK_OUTER_HTML_MAX,
      { timeout: FORENSICS_EVAL_TIMEOUT_MS },
    )
    .then((dom): IClickForensics => ({ ...dom, preClickUrl }))
    .catch((): IClickForensics => ({ ...UNKNOWN_FORENSICS, preClickUrl }));
}

/**
 * Resolve the page URL associated with a frame — `Page.url()` for Page
 * instances, `Frame.url()` for child frames. Defensive against odd Playwright
 * states (closed pages, detached frames) and test-fixture mocks that don't
 * stub `url()` — returns `?` rather than throwing.
 * @param frame - Page or Frame.
 * @returns URL string at the time of call, or `?` on failure.
 */
function frameUrl(frame: Page | Frame): UrlStr {
  const fnHolder = frame as { url?: () => UrlStr };
  if (typeof fnHolder.url !== 'function') return '?';
  try {
    return fnHolder.url();
  } catch {
    return '?';
  }
}

/** Bundled args for emitClickForensics — fits the 3-param ceiling. */
interface IEmitForensicsArgs {
  readonly tier: TierLabel;
  readonly selector: SelectorStr;
  readonly frame: Page | Frame;
  readonly forensics: IClickForensics;
}

/**
 * Emit a single forensic log line for a click outcome — all the data needed
 * to compare CI vs LOCAL: pre/post URL, tier, selector, clicked DOM
 * identity, outerHTML snippet. Always at debug level so it's visible at the
 * standard CI debug level (not gated on trace).
 * @param args - Bundled forensics emit args (tier, selector, frame, forensics).
 * @returns True after emit.
 */
function emitClickForensics(args: IEmitForensicsArgs): true {
  const { tier, selector, frame, forensics } = args;
  LOG.debug({
    message: `Tier ${tier}: OK — ${selector}`,
    tier,
    selector,
    preClickUrl: forensics.preClickUrl,
    postClickUrl: frameUrl(frame),
    clickedTag: forensics.clickedTag,
    clickedDomId: forensics.clickedDomId,
    clickedClasses: forensics.clickedClasses,
    clickedAttrs: forensics.clickedAttrs,
    clickedOuterHtml: forensics.clickedOuterHtml,
  });
  return true;
}

/**
 * Fill an input field via Playwright locator with human-like delay.
 * @param frame - Resolved Page or Frame.
 * @param selector - CSS/XPath selector.
 * @param value - Value to fill.
 * @returns True after filling.
 */
async function fillInputImpl(
  frame: Page | Frame,
  selector: SelectorStr,
  value: ValueStr,
): Promise<true> {
  await deepFillInput(frame, selector, value);
  return true;
}

/** Bundled args for clickElementImpl — fits the 3-param ceiling. */
interface IClickArgs {
  readonly frame: Page | Frame;
  readonly selector: SelectorStr;
  readonly isForce?: boolean;
  /** Optional 0-based nth index when the selector matches multiple DOM
   *  elements (e.g. Beinleumi legacy + modern buttons share aria-label).
   *  Default `.first()` (== `.nth(0)`); ACTION-level iteration provides
   *  i = 0..N-1 via `dashboardCandidateCount`. */
  readonly nth?: number;
}

/**
 * Narrow a base locator to either `.first()` or `.nth(n)` depending on
 * whether the caller specified an nth index. Centralised so the click
 * caller stays inside the ternary-free style this codebase enforces.
 * @param base - Playwright locator (unbound to a position).
 * @param nth - Optional 0-based index; undefined → `.first()`.
 * @returns Bound locator.
 */
function narrowLocator(
  base: ReturnType<Page['locator']>,
  nth?: number,
): ReturnType<Page['locator']> {
  if (nth === undefined) return base.first();
  return base.nth(nth);
}

/**
 * Click an element via Playwright locator with human-like delay.
 * Captures click forensics (pre/post URL + DOM identity + outerHTML) before
 * each tier so CI-vs-LOCAL divergence can be proven from logs alone.
 * @param args - Bundled click arguments (frame, selector, isForce, nth).
 * @returns True after clicking.
 */
async function clickElementImpl(args: IClickArgs): Promise<true> {
  const { frame, selector, isForce, nth } = args;
  await humanDelay(200, 500);
  const base = frame.locator(selector);
  const locator = narrowLocator(base, nth);
  if (!isForce) return clickNaturalPath(locator, selector, frame);
  const forensics = await captureClickForensics(locator, frame);
  const didForceClick = await locator
    .click({ force: true, timeout: CLICK_TIMEOUT_MS })
    .then((): true => true)
    .catch((): false => false);
  if (didForceClick) return emitClickForensics({ tier: 'force-1', selector, frame, forensics });
  LOG.debug({ message: `Tier 1 (force): FAIL — ${selector}` });
  const didDispatch = await locator
    .dispatchEvent('click')
    .then((): true => true)
    .catch((): false => false);
  if (didDispatch) return emitClickForensics({ tier: 'dispatch-2', selector, frame, forensics });
  LOG.debug({ message: `Tier 2 (dispatch): FAIL — ${selector}` });
  return evaluateJsClick(locator, selector, frame);
}

/**
 * Natural click path: Tier 1 (click) → Tier 3 (JS evaluate).
 * Captures forensics before the click so the post-click URL + clicked DOM
 * identity surface in the success log.
 * @param locator - Playwright locator.
 * @param selector - Selector string for logging.
 * @param frame - Page or Frame the click runs in (for forensics + post-URL).
 * @returns True after click (throws on failure — callers rely on throw).
 */
async function clickNaturalPath(
  locator: ReturnType<Page['locator']>,
  selector: SelectorStr,
  frame: Page | Frame,
): Promise<true> {
  const forensics = await captureClickForensics(locator, frame);
  await locator.click({ timeout: CLICK_TIMEOUT_MS });
  return emitClickForensics({ tier: 'natural-1', selector, frame, forensics });
}

/**
 * Tier 3: JS-level el.click() — bypasses coordinates entirely.
 * Triggers Angular Zone.js handlers directly on the element.
 * @param locator - Playwright locator for the element.
 * @param selector - Selector string for logging.
 * @returns True after JS click.
 */
/** Timeout for Tier 3 JS evaluate (shorter than locator default). */
const EVALUATE_TIMEOUT_MS = 5_000;

/**
 * Tier 3: JS-level el.click() — bypasses coordinates entirely.
 * Uses short timeout. If locator.evaluate fails, falls back to
 * frame.evaluate with aria-label query (no Playwright selector).
 * @param locator - Playwright locator for the element.
 * @param selector - Selector string for logging.
 * @param frame - Page or Frame for direct DOM fallback.
 * @returns True after JS click.
 */
/**
 * Tier 3: JS-level el.click() — bypasses coordinates entirely.
 * Always called with a frame from `clickElementImpl`; emits full click
 * forensics on success and falls through to Tier 4 (DOM query) on locator
 * timeout.
 * @param locator - Playwright locator.
 * @param selector - Selector string.
 * @param frame - Page or Frame the click runs in.
 * @returns True after JS click.
 */
async function evaluateJsClick(
  locator: ReturnType<Page['locator']>,
  selector: SelectorStr,
  frame: Page | Frame,
): Promise<true> {
  LOG.debug({ message: `Tier 3 (JS evaluate): attempting — ${selector}` });
  const forensics = await captureClickForensics(locator, frame);
  const didEval = await locator
    .evaluate(
      (el: HTMLElement): true => {
        el.click();
        return true;
      },
      null,
      { timeout: EVALUATE_TIMEOUT_MS },
    )
    .then((): true => true)
    .catch((): false => false);
  if (didEval) return emitClickForensics({ tier: 'evaluate-3', selector, frame, forensics });
  LOG.debug({ message: 'Tier 3 (JS evaluate): locator timeout — trying DOM query' });
  await clickViaAriaLabel(frame, selector);
  return true;
}

/**
 * Tier 4: Direct DOM query by aria-label — no Playwright selector.
 * Extracts aria-label from the selector string and queries DOM directly.
 * @param frame - Page or Frame to execute in.
 * @param selector - Playwright selector (parsed for aria-label).
 * @returns True after click attempt.
 */
async function clickViaAriaLabel(frame: Page | Frame, selector: SelectorStr): Promise<true> {
  const ariaMatch = /name="([^"]+)"/.exec(selector);
  if (!ariaMatch) {
    LOG.debug({ message: 'Tier 4 (DOM query): no aria-label in selector' });
    return true;
  }
  const ariaLabel = ariaMatch[1];
  LOG.debug({ message: `Tier 4 (DOM query): clicking aria-label="${ariaLabel}"` });
  await frame
    .evaluate((label: string): true => {
      const buttons = document.querySelectorAll(`button[aria-label="${label}"]`);
      const lastBtn = buttons[buttons.length - 1] as HTMLElement | undefined;
      if (lastBtn) lastBtn.click();
      return true;
    }, ariaLabel)
    .catch((): false => false);
  return true;
}

/**
 * Press Enter in a frame context with human-like delay.
 * @param frame - Resolved Page or Frame (keyboard via page).
 * @returns True after pressing.
 */
async function pressEnterImpl(frame: Page | Frame): Promise<true> {
  await humanDelay(100, 300);
  const hasKeyboard = 'keyboard' in frame;
  const pageMap: Record<string, Page> = {
    true: frame as Page,
    false: (frame as Frame).page(),
  };
  const kb = pageMap[String(hasKeyboard)].keyboard;
  await kb.press('Enter');
  return true;
}

/**
 * Default selector builder — fallback for unknown kinds.
 * @param v - Candidate value.
 * @returns Text selector string.
 */
const DEFAULT_BUILDER = (v: ValueStr): SelectorStr => `text=${v}`;

/**
 * Build text selector from visible text.
 * @param v - Visible text value.
 * @returns Playwright text selector.
 */
function buildText(v: ValueStr): SelectorStr {
  return `text=${v}`;
}

/**
 * Build exact text selector (quoted).
 * @param v - Exact visible text.
 * @returns Playwright quoted text selector.
 */
function buildExact(v: ValueStr): SelectorStr {
  return `text="${v}"`;
}

/**
 * Build CSS attribute selector from ARIA label — tag-agnostic.
 * Matches <button>, <a>, <div role="button"> alike. Previous variant
 * (`role=button[name=…]`) only matched elements whose accessible role
 * resolved to "button"; that filtered out `<a aria-label=…>` (implicit
 * role=link) and timed out on Wix-styled link triggers.
 * @param v - ARIA label value.
 * @returns CSS attribute selector matching any element with the label.
 */
function buildAria(v: ValueStr): SelectorStr {
  return `[aria-label="${v}"]`;
}

/**
 * Build placeholder attribute selector.
 * @param v - Placeholder text.
 * @returns CSS attribute selector.
 */
function buildPlaceholder(v: ValueStr): SelectorStr {
  return `[placeholder="${v}"]`;
}

/**
 * Pass through raw selector (XPath or CSS).
 * @param v - Raw selector string.
 * @returns Same string unchanged.
 */
function buildPassthrough(v: ValueStr): SelectorStr {
  return v;
}

/**
 * Build name attribute selector.
 * @param v - Input name value.
 * @returns CSS name attribute selector.
 */
function buildName(v: ValueStr): SelectorStr {
  return `[name="${v}"]`;
}

/**
 * Build regex text selector.
 * @param v - Regex pattern string.
 * @returns Playwright regex text selector.
 */
function buildRegex(v: ValueStr): SelectorStr {
  return `text=/${v}/`;
}

/** Playwright selector engine prefix map — candidate kind to locator string builder. */
const SELECTOR_BUILDERS: Readonly<Record<string, (v: ValueStr) => SelectorStr>> = {
  textContent: buildText,
  exactText: buildExact,
  clickableText: buildText,
  ariaLabel: buildAria,
  placeholder: buildPlaceholder,
  xpath: buildPassthrough,
  css: buildPassthrough,
  name: buildName,
  regex: buildRegex,
  labelText: buildText,
};

/**
 * Convert a SelectorCandidate to a Playwright locator selector string.
 * @param candidate - The selector candidate from WK or config.
 * @returns Playwright-compatible selector string.
 */
function candidateToSelector(candidate: SelectorCandidate): SelectorStr {
  const builder = SELECTOR_BUILDERS[candidate.kind] ?? DEFAULT_BUILDER;
  return builder(candidate.value);
}

/** Sentinel string used by extractIdentity for absent attribute values. */
const NO_ATTR_VALUE = '(none)';

/**
 * True when the identity attribute string is present (not the sentinel and
 * not empty). Centralised so all tiers of buildPreciseSelector use the
 * exact same predicate.
 * @param v - Attribute value from IElementIdentity.
 * @returns True iff `v` is a real, non-empty attribute value.
 */
function hasAttr(v: string): IsAttrPresent {
  if (v === NO_ATTR_VALUE) return false;
  if (v.length === 0) return false;
  return true;
}

/**
 * Build a precise CSS attribute selector from the resolved element's actual
 * DOM identity, in priority order:
 *   1. id          → `[id="…"]`        (most specific, almost always unique)
 *   2. name        → `[name="…"]`      (form fields)
 *   3. aria-label  → `[aria-label="…"]` (semantic labels)
 *   4. title       → `[title="…"]`     (Bootstrap-style buttons)
 *   5. href        → `[href="…"]`      (anchor links)
 *
 * The selector matches the EXACT element PRE found, regardless of which WK
 * candidate kind triggered the match. This lets ariaLabel-kind candidates
 * still resolve elements that have only `title` or `textContent` (cf. the
 * Beinleumi `<button id="sendSms" title="שלח">שלח</button>` regression: PRE
 * matches via getByRole accessible-name, ACTION needs a selector that
 * matches the same element). Returns false when no usable attribute is
 * present (caller falls back to candidate-based selector).
 * @param identity - DOM identity captured by `extractIdentity` at PRE time.
 * @returns CSS attribute selector string, or false if no attribute is usable.
 */
function buildIdentitySelector(identity: IElementIdentity): SelectorStr | false {
  if (hasAttr(identity.id)) return `[id="${identity.id}"]`;
  if (hasAttr(identity.name)) return `[name="${identity.name}"]`;
  if (hasAttr(identity.ariaLabel)) return `[aria-label="${identity.ariaLabel}"]`;
  if (hasAttr(identity.title)) return `[title="${identity.title}"]`;
  if (hasAttr(identity.href)) return `[href="${identity.href}"]`;
  return false;
}

/**
 * Convert an IRaceResult from PRE discovery to an IResolvedTarget for ACTION.
 * Requires the result to have found an element (found=true, context!==false).
 * Builds the click selector from the resolved element's actual identity
 * (via `buildIdentitySelector`) when possible, falling back to the candidate-
 * based selector only when no stable attribute is available. This keeps the
 * tag-agnostic gain of `buildAria` (matches `<a>` / `<div role="button">`
 * alike) while restoring matches for elements whose accessible name comes
 * from `title` or `textContent` rather than a literal `aria-label`.
 * @param result - The race result from resolveVisible.
 * @param page - The main page (for contextId computation).
 * @returns IResolvedTarget with contextId + selector, or false if not found.
 */
function raceResultToTarget(result: IRaceResult, page: Page): IResolvedTarget | false {
  if (!result.found) return false;
  if (!result.context) return false;
  if (!result.candidate) return false;
  const contextId: ContextId = computeContextId(result.context, page);
  const fromIdentity = result.identity && buildIdentitySelector(result.identity);
  const selector = fromIdentity || candidateToSelector(result.candidate);
  return {
    selector,
    contextId,
    kind: result.candidate.kind,
    candidateValue: result.candidate.value,
  };
}

export type { FrameRegistryMap } from './FrameRegistry.js';
export {
  buildFrameRegistry,
  computeContextId,
  MAIN_CONTEXT_ID,
  resolveFrame,
} from './FrameRegistry.js';
export { candidateToSelector, clickElementImpl, fillInputImpl, pressEnterImpl, raceResultToTarget };
