/**
 * OTP-DETECTOR Click — bank-aware trigger and candidate clickers.
 * Handles SMS-trigger discovery and the public `clickFromCandidates`
 * entry-point used by the OTP Mediator phases.
 */

import { type Frame, type Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { getDebug } from '../../Types/Debug.js';
import { tryInContext } from '../Selector/SelectorResolver.js';
import tryClickTextInContexts from './OtpDetector.ClickText.js';
import runSequential from './OtpDetector.Sequential.js';
import { OTP_FALLBACK_CLICK_TIMEOUT_MS, SMS_TRIGGER_CANDIDATES } from './OtpDetectorConfig.js';

const LOG = getDebug(import.meta.url);

/** Text-based candidate kinds. */
const TEXT_KINDS = ['textContent', 'clickableText'] as const;

/**
 * Extract text values from text-based candidates.
 * @param candidates - Selector candidates to filter.
 * @returns Array of text values.
 */
function extractTextValues(candidates: readonly SelectorCandidate[]): string[] {
  return candidates
    .filter(c => TEXT_KINDS.includes(c.kind as (typeof TEXT_KINDS)[number]))
    .map(c => c.value);
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

/** Promise<boolean> alias keeping single-line signatures. */
type Bool = Promise<boolean>;

/**
 * Try resolving and clicking a fallback selector in a single context.
 * @param ctx - The Page or Frame context.
 * @param candidates - Selector candidates to resolve.
 * @returns True if a selector was found and clicked.
 */
async function tryFallbackClick(ctx: Page | Frame, candidates: readonly SelectorCandidate[]): Bool {
  const sel = await tryInContext(ctx, candidates);
  if (!sel) return false;
  LOG.debug('clickFromCandidates: fallback selector: %s', sel);
  return ctx
    .click(sel, { timeout: OTP_FALLBACK_CLICK_TIMEOUT_MS })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Curried tryFallbackClick — captures `SMS_TRIGGER_CANDIDATES` so the
 * caller can pass a single-arg lambda to {@link runSequential} without
 * inlining a non-JSDoc'd arrow expression.
 * @param ctx - Single Page/Frame context.
 * @returns True if a trigger was found and clicked.
 */
async function tryFallbackTrigger(ctx: Page | Frame): Bool {
  return tryFallbackClick(ctx, SMS_TRIGGER_CANDIDATES);
}

/**
 * Try SMS trigger fallback across all contexts sequentially.
 * @param contexts - Ordered list of Page/Frame contexts.
 * @returns True if a trigger was found and clicked.
 */
async function tryFallbackInAllContexts(contexts: (Page | Frame)[]): Bool {
  const results = await runSequential(contexts, tryFallbackTrigger);
  return results.some(Boolean);
}

/**
 * Try fallback selector resolution across all contexts sequentially.
 * @param contexts - Ordered list of Page/Frame contexts.
 * @param candidates - Selector candidates to resolve.
 * @returns True if a fallback selector was found and clicked.
 */
async function tryFallbackInContexts(
  contexts: (Page | Frame)[],
  candidates: readonly SelectorCandidate[],
): Promise<boolean> {
  const results = await runSequential(contexts, ctx => tryFallbackClick(ctx, candidates));
  return results.some(Boolean);
}

/**
 * Click the SMS trigger button if one is found on the page or in frames.
 * @param page - The Playwright page to search for SMS triggers.
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns True if a trigger was clicked, false if none found.
 */
async function clickOtpTriggerIfPresent(page: Page, cachedFrames?: Frame[]): Promise<boolean> {
  const textValues = extractTextValues(SMS_TRIGGER_CANDIDATES);
  const contexts = buildContextList(page, cachedFrames);
  const didClick = await tryClickTextInContexts(contexts, textValues);
  if (didClick) return true;
  const hasFallback = await tryFallbackInAllContexts(contexts);
  if (hasFallback) return true;
  LOG.debug('No SMS trigger found — SMS may be auto-sent');
  return false;
}

/** Bundled args for {@link clickFromCandidates} — keeps positional cap. */
interface IClickFromCandidatesArgs {
  readonly page: Page;
  readonly candidates: readonly SelectorCandidate[];
  readonly cachedFrames?: Frame[];
}

/**
 * Click the first matching candidate from a bank-specific selector list.
 * Uses the same tryInContext resolver pipeline as field resolution.
 * @param page - The Playwright page to search.
 * @param candidates - Ordered SelectorCandidate list (text-based preferred).
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns True if a candidate was found and clicked, false otherwise.
 */
async function clickFromCandidates(
  page: Page,
  candidates: readonly SelectorCandidate[],
  cachedFrames?: Frame[],
): Promise<boolean> {
  const args: IClickFromCandidatesArgs = { page, candidates, cachedFrames };
  return clickFromCandidatesImpl(args);
}

/**
 * Inner implementation of {@link clickFromCandidates} — keeps the
 * public wrapper a thin positional adapter so the entry signature
 * matches every consumer of the prior single-export file.
 * @param args - Bundle of page, candidates, optional cached frames.
 * @returns True if a candidate was found and clicked.
 */
async function clickFromCandidatesImpl(args: IClickFromCandidatesArgs): Promise<boolean> {
  const textValues = extractTextValues(args.candidates);
  const contexts = buildContextList(args.page, args.cachedFrames);
  const didClick = await tryClickTextInContexts(contexts, textValues);
  if (didClick) return true;
  const hasFallback = await tryFallbackInContexts(contexts, args.candidates);
  if (hasFallback) return true;
  LOG.debug('clickFromCandidates: no clickable match found');
  return false;
}

export { clickFromCandidates, clickOtpTriggerIfPresent };
