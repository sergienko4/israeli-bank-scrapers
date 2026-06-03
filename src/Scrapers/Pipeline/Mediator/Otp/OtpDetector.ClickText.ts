/**
 * OTP-DETECTOR Click-Text — XPath innermost-text resolver and the
 * sequential click-attempt machinery shared by the OTP click paths.
 */

import { type Frame, type Page } from 'playwright-core';

import type { LifecyclePromise } from '../../../Base/Interfaces/CallbackTypes.js';
import { getDebug } from '../../Types/Debug.js';
import { toXpathLiteral } from '../Selector/SelectorResolver.js';
import runSequential from './OtpDetector.Sequential.js';
import { OTP_FORCE_CLICK_TIMEOUT_MS } from './OtpDetectorConfig.js';

const LOG = getDebug(import.meta.url);

/** XPath predicate restricting matches to interactive elements. */
const INTERACTIVE_FILTER = [
  '(self::button or self::a or self::input',
  'or self::select or self::textarea',
  'or @role="button" or @role="link")',
].join(' ');

/**
 * Build an XPath matching the innermost interactive element with text.
 * @param text - The visible text to match.
 * @returns Playwright XPath selector for clickable elements only.
 */
function innermostTextXpath(text: string): string {
  const escaped = toXpathLiteral(text);
  return [
    `xpath=//*[${INTERACTIVE_FILTER}`,
    `and contains(., ${escaped})`,
    `and not(.//*[${INTERACTIVE_FILTER} and contains(., ${escaped})])]`,
  ].join(' ');
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
    .click({ timeout: OTP_FORCE_CLICK_TIMEOUT_MS, force: true })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Try force-clicking matched elements sequentially, stopping after first success.
 * @param matches - Array of locator elements to attempt clicking.
 * @returns Array of click results (true/false per element).
 */
async function sequentialForceClicks(matches: IClickable[]): Promise<boolean[]> {
  return runSequential(matches, match => tryForceClick(match));
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
 * Try clicking each text sequentially, stopping after first success.
 * @param ctx - Page or Frame to search.
 * @param texts - Text values to attempt.
 * @returns Array of results (true/false per text).
 */
async function sequentialClickAttempts(ctx: Page | Frame, texts: string[]): Promise<boolean[]> {
  return runSequential(texts, text => tryClickInnermostText(ctx, text));
}

/**
 * Log diagnostic for a successful single-context click.
 * Extracted so {@link tryClickTextInSingleContext} stays ≤10 lines.
 * @param text - The matched text that was clicked.
 * @param isMain - Whether the click happened in the main page context.
 * @returns Sentinel `true` — callers discard it; the log is the point.
 */
function logClickHit(text: string, isMain: boolean): true {
  const label = isMain ? 'main' : 'frame';
  LOG.debug('clicked "%s" in %s', text, label);
  return true;
}

/** Promise<boolean> alias keeping single-line signatures. */
type Bool = Promise<boolean>;
/** Promise<boolean[]> alias keeping single-line signatures. */
type BoolList = Promise<boolean[]>;
/** Convenience: ordered list of Page/Frame contexts. */
type Ctxs = (Page | Frame)[];

/** Single Page/Frame context alias. */
type Ctx = Page | Frame;

/**
 * Try clicking visible text in a single context.
 * @param ctx - Page or Frame to search.
 * @param texts - Text values to look for.
 * @param isMain - Whether ctx is the main page.
 * @returns True if a click succeeded.
 */
async function tryClickTextInSingleContext(ctx: Ctx, texts: string[], isMain: boolean): Bool {
  const results = await sequentialClickAttempts(ctx, texts);
  const idx = results.findIndex(Boolean);
  if (idx < 0) return false;
  return logClickHit(texts[idx], isMain);
}

/**
 * Try clicking text in each context sequentially.
 * @param contexts - Ordered list of contexts.
 * @param texts - Text values to attempt.
 * @returns Array of results (true/false per context).
 */
async function sequentialContextAttempts(contexts: Ctxs, texts: string[]): BoolList {
  return runSequential(contexts, (ctx, idx) => tryClickTextInSingleContext(ctx, texts, idx === 0));
}

/**
 * Log diagnostic for a no-match outcome across contexts.
 * Extracted so {@link tryClickTextInContexts} stays ≤10 lines.
 * @param contexts - Ordered list of contexts that were searched.
 * @param texts - Text values that were attempted.
 * @returns Sentinel `true` — callers discard it; the log is the point.
 */
function logNoTextMatch(contexts: Ctxs, texts: string[]): true {
  LOG.debug('no match in %d contexts for %d texts', contexts.length, texts.length);
  return true;
}

/**
 * Try clicking visible text across all contexts.
 * @param contexts - Ordered list of contexts to search.
 * @param texts - Text values to look for.
 * @returns True if a click succeeded.
 */
async function tryClickTextInContexts(contexts: Ctxs, texts: string[]): Bool {
  const results = await sequentialContextAttempts(contexts, texts);
  const didMatch = results.some(Boolean);
  if (!didMatch) logNoTextMatch(contexts, texts);
  return didMatch;
}

export default tryClickTextInContexts;
