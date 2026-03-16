import { type Frame, type Page } from 'playwright-core';

import type { SelectorCandidate } from '../Scrapers/Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../Scrapers/Base/Interfaces/CallbackTypes.js';
import {
  OTP_INPUT_CANDIDATES,
  OTP_SUBMIT_CANDIDATES,
  OTP_TEXT_PATTERNS,
  PHONE_PATTERN,
  SMS_TRIGGER_CANDIDATES,
} from './Config/OtpDetectorConfig.js';
import { getDebug } from './Debug.js';
import { toXpathLiteral, tryInContext } from './SelectorResolver.js';

const LOG = getDebug('otp-detector');

/** Pre-resolved promise used as initial value for sequential reduce chains. */
const RESOLVED_PROMISE = Promise.resolve();

export { OTP_SUBMIT_CANDIDATES };

type TextCheckResult = 'otp' | 'clear' | 'unknown';

/**
 * Retrieve the visible body text from the page for OTP pattern matching.
 * @param page - The Playwright page to read body text from.
 * @returns The body text content, or empty string on failure.
 */
async function getBodyText(page: Page): Promise<string> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return typeof text === 'string' ? text : '';
  } catch (e: unknown) {
    LOG.debug(e, 'getBodyText failed (page context inaccessible)');
    return '';
  }
}

/**
 * Detect OTP presence by matching known text patterns in the page body.
 * @param page - The Playwright page to check.
 * @returns The detection result: 'otp', 'clear', or 'unknown'.
 */
async function detectByText(page: Page): Promise<TextCheckResult> {
  const bodyText = await getBodyText(page);
  if (bodyText === '') return 'unknown';
  return OTP_TEXT_PATTERNS.some(pattern => bodyText.includes(pattern)) ? 'otp' : 'clear';
}

/**
 * Check a single frame for OTP input candidates.
 * @param frame - The frame to search within.
 * @returns True if an OTP input was found in the frame.
 */
async function checkFrameForOtpInput(frame: Frame): Promise<boolean> {
  const found = await tryInContext(frame, OTP_INPUT_CANDIDATES);
  return !!found;
}

/**
 * Detect OTP presence by searching for known OTP input fields on the page and in frames.
 * @param page - The Playwright page to search.
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns True if an OTP input field was found.
 */
async function detectByInputField(page: Page, cachedFrames?: Frame[]): Promise<boolean> {
  const found = await tryInContext(page, OTP_INPUT_CANDIDATES);
  if (found) return true;
  const mainFrame = page.mainFrame();
  const frames = cachedFrames ?? page.frames().filter(f => f !== mainFrame);
  const frameTasks = frames.map(checkFrameForOtpInput);
  const results = await Promise.all(frameTasks);
  return results.some(Boolean);
}

/**
 * Detect whether the current page is showing an OTP screen.
 * @param page - The Playwright page to check for OTP indicators.
 * @returns True if an OTP screen is detected.
 */
export async function detectOtpScreen(page: Page): Promise<boolean> {
  const textResult = await detectByText(page);
  if (textResult === 'otp') {
    LOG.debug('OTP detected by text pattern');
    return true;
  }
  if (textResult === 'unknown') {
    LOG.debug('Page context inaccessible — skipping OTP input check');
    return false;
  }
  const isByInput = await detectByInputField(page);
  if (isByInput) LOG.debug('OTP detected by input field');
  return isByInput;
}

/**
 * Extract the masked phone number hint from the OTP screen body text.
 * @param page - The Playwright page to search for the phone hint.
 * @returns The matched phone hint string, or empty string if not found.
 */
export async function extractPhoneHint(page: Page): Promise<string> {
  const bodyText = await getBodyText(page);
  const matched = PHONE_PATTERN.exec(bodyText);
  return matched?.[0] ?? '';
}

/**
 * Find the Playwright selector for the OTP submit button across all frames.
 * @param page - The Playwright page to search for submit buttons.
 * @returns The matched selector (CSS or XPath), or empty string if not found.
 */
export async function findOtpSubmitSelector(page: Page): Promise<string> {
  const main = await tryInContext(page, OTP_SUBMIT_CANDIDATES);
  if (main) return main;
  const mainFrame = page.mainFrame();
  const nonMainFrames = page.frames().filter(f => f !== mainFrame);
  const frameTasks = nonMainFrames.map(frame => tryInContext(frame, OTP_SUBMIT_CANDIDATES));
  const results = await Promise.all(frameTasks);
  return results.find(sel => sel.length > 0) ?? '';
}

/** Result of an SMS trigger search with selector and context. */
interface ISmsTriggerResult {
  selector: string;
  context: Page | Frame;
}

/**
 * Search all frames for an SMS trigger button.
 * @param page - The Playwright page to search.
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns The trigger selector and context, or empty selector if not found.
 */
async function findSmsTriggerInFrames(
  page: Page,
  cachedFrames?: Frame[],
): Promise<ISmsTriggerResult> {
  const mainSel = await tryInContext(page, SMS_TRIGGER_CANDIDATES);
  if (mainSel) return { selector: mainSel, context: page };
  const mainFrame = page.mainFrame();
  const frames = cachedFrames ?? page.frames().filter(f => f !== mainFrame);
  const frameTasks = frames.map(async (frame): Promise<ISmsTriggerResult | false> => {
    const sel = await tryInContext(frame, SMS_TRIGGER_CANDIDATES);
    return sel ? { selector: sel, context: frame } : false;
  });
  const results = await Promise.all(frameTasks);
  const found = results.find((r): r is ISmsTriggerResult => r !== false);
  return found ?? { selector: '', context: page };
}

/**
 * Click the SMS trigger button if one is found on the page or in frames.
 * @param page - The Playwright page to search for SMS triggers.
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns True if a trigger was clicked, false if none found.
 */
export async function clickOtpTriggerIfPresent(
  page: Page,
  cachedFrames?: Frame[],
): Promise<boolean> {
  const textValues = extractTextValues(SMS_TRIGGER_CANDIDATES);
  const contexts = buildContextList(page, cachedFrames);
  const didClick = await tryClickTextInContexts(contexts, textValues);
  if (didClick) return true;
  const trigger = await findSmsTriggerInFrames(page, cachedFrames);
  if (trigger.selector) {
    LOG.debug('clicking SMS trigger fallback: %s', trigger.selector);
    const isClicked = await trigger.context
      .click(trigger.selector, { timeout: 5000 })
      .then((): true => true)
      .catch((): false => false);
    return isClicked;
  }
  LOG.debug('No SMS trigger found — SMS may be auto-sent');
  return false;
}

/** Text-based candidate kinds. */
const TEXT_KINDS = ['textContent', 'clickableText'] as const;

/**
 * Extract text values from text-based candidates.
 * @param candidates - Selector candidates to filter.
 * @returns Array of text values.
 */
function extractTextValues(candidates: SelectorCandidate[]): string[] {
  return candidates
    .filter(c => TEXT_KINDS.includes(c.kind as (typeof TEXT_KINDS)[number]))
    .map(c => c.value);
}

/**
 * Try fallback selector resolution across all contexts sequentially.
 * @param contexts - Ordered list of Page/Frame contexts.
 * @param candidates - Selector candidates to resolve.
 * @returns True if a fallback selector was found and clicked.
 */
async function tryFallbackInContexts(
  contexts: (Page | Frame)[],
  candidates: SelectorCandidate[],
): Promise<boolean> {
  const tasks = contexts.map(async (ctx): Promise<boolean> => {
    const sel = await tryInContext(ctx, candidates);
    if (!sel) return false;
    LOG.debug('clickFromCandidates: fallback selector: %s', sel);
    return ctx
      .click(sel, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  });
  const results = await Promise.all(tasks);
  return results.some(Boolean);
}

/**
 * Click the first matching candidate from a bank-specific selector list.
 * Uses the same tryInContext resolver pipeline as field resolution.
 * @param page - The Playwright page to search.
 * @param candidates - Ordered SelectorCandidate list (text-based preferred).
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns True if a candidate was found and clicked, false otherwise.
 */
export async function clickFromCandidates(
  page: Page,
  candidates: SelectorCandidate[],
  cachedFrames?: Frame[],
): Promise<boolean> {
  const textValues = extractTextValues(candidates);
  const contexts = buildContextList(page, cachedFrames);
  const didClick = await tryClickTextInContexts(contexts, textValues);
  if (didClick) return true;
  const hasFallback = await tryFallbackInContexts(contexts, candidates);
  if (hasFallback) return true;
  LOG.debug('clickFromCandidates: no clickable match found');
  return false;
}

/**
 * Build ordered list of contexts to search: main page then child frames.
 * @param page - The Playwright page.
 * @param cachedFrames - Optional cached frames list.
 * @returns Array of Page/Frame contexts to search.
 */
function buildContextList(page: Page, cachedFrames?: Frame[]): (Page | Frame)[] {
  const mainFrame = page.mainFrame();
  const frames = cachedFrames ?? page.frames().filter(f => f !== mainFrame);
  return [page, ...frames];
}

/**
 * Try clicking visible text in a single context.
 * @param ctx - Page or Frame to search.
 * @param texts - Text values to look for.
 * @param isMain - Whether ctx is the main page.
 * @returns True if a click succeeded.
 */
async function tryClickTextInSingleContext(
  ctx: Page | Frame,
  texts: string[],
  isMain: boolean,
): Promise<boolean> {
  const results = await sequentialClickAttempts(ctx, texts);
  const idx = results.findIndex(Boolean);
  if (idx >= 0) {
    const label = isMain ? 'main' : 'frame';
    LOG.debug('clicked "%s" in %s', texts[idx], label);
    return true;
  }
  return false;
}

/**
 * Try clicking each text sequentially, stopping after first success.
 * @param ctx - Page or Frame to search.
 * @param texts - Text values to attempt.
 * @returns Array of results (true/false per text).
 */
async function sequentialClickAttempts(ctx: Page | Frame, texts: string[]): Promise<boolean[]> {
  const results: boolean[] = [];
  const reducer = texts.reduce(
    (chain, text) =>
      chain.then(async () => {
        if (results.some(Boolean)) {
          results.push(false);
          return;
        }
        const didClick = await tryClickInnermostText(ctx, text);
        results.push(didClick);
      }),
    RESOLVED_PROMISE,
  );
  await reducer;
  return results;
}

/**
 * Try clicking visible text across all contexts.
 * @param contexts - Ordered list of contexts to search.
 * @param texts - Text values to look for.
 * @returns True if a click succeeded.
 */
async function tryClickTextInContexts(
  contexts: (Page | Frame)[],
  texts: string[],
): Promise<boolean> {
  const results = await sequentialContextAttempts(contexts, texts);
  const didMatch = results.some(Boolean);
  if (!didMatch) {
    LOG.debug('no match in %d contexts for %d texts', contexts.length, texts.length);
  }
  return didMatch;
}

/**
 * Try clicking text in each context sequentially, stopping after first success.
 * @param contexts - Ordered list of contexts.
 * @param texts - Text values to attempt.
 * @returns Array of results (true/false per context).
 */
async function sequentialContextAttempts(
  contexts: (Page | Frame)[],
  texts: string[],
): Promise<boolean[]> {
  const results: boolean[] = [];
  const reducer = contexts.reduce(
    (chain, ctx, idx) =>
      chain.then(async () => {
        if (results.some(Boolean)) {
          results.push(false);
          return;
        }
        const didClick = await tryClickTextInSingleContext(ctx, texts, idx === 0);
        results.push(didClick);
      }),
    RESOLVED_PROMISE,
  );
  await reducer;
  return results;
}

/**
 * Build an innermost-text XPath for the given visible text.
 * @param text - The visible text to match.
 * @returns Playwright XPath selector string.
 */
function innermostTextXpath(text: string): string {
  const escaped = toXpathLiteral(text);
  return [
    'xpath=//*[not(self::script)',
    'and not(self::style)',
    `and contains(., ${escaped})`,
    `and not(.//*[contains(., ${escaped})])]`,
  ].join(' ');
}

/**
 * Find the innermost element containing text and click it.
 * @param ctx - Page or Frame to search.
 * @param text - Visible text to find.
 * @returns True if clicked successfully.
 */
async function tryClickInnermostText(ctx: Page | Frame, text: string): Promise<boolean> {
  const xpathSelector = innermostTextXpath(text);
  const locator = ctx.locator(xpathSelector);
  const matches = await locator.all();
  const results = await sequentialForceClicks(matches);
  return results.some(Boolean);
}

/**
 * Try force-clicking matched elements sequentially, stopping after first success.
 * @param matches - Array of locator elements to attempt clicking.
 * @returns Array of click results (true/false per element).
 */
async function sequentialForceClicks(matches: IClickable[]): Promise<boolean[]> {
  const results: boolean[] = [];
  const reducer = matches.reduce(
    (chain, match) =>
      chain.then(async () => {
        if (results.some(Boolean)) {
          results.push(false);
          return;
        }
        const didClick = await tryForceClick(match);
        results.push(didClick);
      }),
    RESOLVED_PROMISE,
  );
  await reducer;
  return results;
}

/** Locator with a click method. */
interface IClickable {
  click: (o: { timeout: number; force: boolean }) => LifecyclePromise;
}

/**
 * Attempt to force-click a single locator element.
 * @param loc - The Playwright locator to click.
 * @returns True if clicked, false on error.
 */
async function tryForceClick(loc: IClickable): Promise<boolean> {
  return loc
    .click({ timeout: 3000, force: true })
    .then((): true => true)
    .catch((): false => false);
}
