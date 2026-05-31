/**
 * WafChallengeDetector — pure-function frame-URL classifier.
 *
 * Scans every frame on the page (top + nested iframes) and matches the URL
 * against the provider URL substring tables in WafChallengeConfig.ts.
 * Returns the first matching frame wrapped in an Option, or none() when no
 * known challenge is mounted.
 *
 * Pure I/O wrappers are isolated (safeFrameUrl, listFramesSafe) so a frame
 * whose underlying page is mid-navigation cannot throw upward into the
 * polling loop.
 */

import type { Frame, Page } from 'playwright-core';

import { none, type Option, some } from '../../Types/Option.js';
import {
  HCAPTCHA_IFRAME_URL_PATTERNS,
  TURNSTILE_IFRAME_URL_PATTERNS,
} from './WafChallengeConfig.js';
import type { IWafChallenge, WafChallengeKind } from './WafChallengeTypes.js';

/** Sentinel — distinguishable unmatched kind so callers branch on string equality. */
const NO_KIND = '' as const;

type ClassifiedKind = WafChallengeKind | typeof NO_KIND;

/**
 * Read frame.url() defensively — a detached / navigating frame can throw.
 * @param frame - The Playwright frame.
 * @returns The URL or empty string when the call fails.
 */
function safeFrameUrl(frame: Frame): string {
  try {
    return frame.url();
  } catch {
    return '';
  }
}

/**
 * Check whether a frame's URL contains any of the provider's URL substrings.
 * @param frame - The frame to inspect.
 * @param patterns - Provider URL substring table.
 * @returns True when a match is found.
 */
function frameMatches(frame: Frame, patterns: readonly string[]): boolean {
  const url = safeFrameUrl(frame);
  if (url === '') return false;
  return patterns.some((pattern): boolean => url.includes(pattern));
}

/**
 * Classify a frame against the registered provider URL tables.
 * @param frame - Candidate frame.
 * @returns The provider kind or NO_KIND when no provider matches.
 */
function classify(frame: Frame): ClassifiedKind {
  if (frameMatches(frame, HCAPTCHA_IFRAME_URL_PATTERNS)) return 'hcaptcha-checkbox';
  if (frameMatches(frame, TURNSTILE_IFRAME_URL_PATTERNS)) return 'turnstile-checkbox';
  return NO_KIND;
}

/**
 * Enumerate frames on the page defensively — a closed page throws.
 * @param page - Playwright page.
 * @returns Frame array or empty when page.frames() throws.
 */
function listFramesSafe(page: Page): readonly Frame[] {
  try {
    return page.frames();
  } catch {
    return [];
  }
}

/**
 * Scan one frame and emit some({kind, frame}) on hit. Extracted from
 * detectChallenge so the loop body has zero nested blocks (max-depth).
 * @param frame - Candidate frame.
 * @returns Some(challenge) on match, none() otherwise.
 */
function classifyOne(frame: Frame): Option<IWafChallenge> {
  const kind = classify(frame);
  if (kind === NO_KIND) return none();
  return some<IWafChallenge>({ kind, frame });
}

/**
 * Predicate — true when the option is Some.
 * @param opt - Option to test.
 * @returns True when opt.has is true.
 */
function isHit(opt: Option<IWafChallenge>): boolean {
  return opt.has;
}

/**
 * Scan every frame and return the first matching WAF challenge frame.
 *
 * <p>Top frame is scanned too — some banks render the challenge in the
 * main document via document.write() before the SPA mounts.
 *
 * @param page - The Playwright page to scan.
 * @returns some({ kind, frame }) on hit, none() otherwise.
 */
function detectChallenge(page: Page): Option<IWafChallenge> {
  const frames = listFramesSafe(page);
  const classified = frames.map(classifyOne);
  const firstHit = classified.find(isHit);
  return firstHit ?? none();
}

export {
  classify,
  classifyOne,
  detectChallenge,
  frameMatches,
  isHit,
  listFramesSafe,
  safeFrameUrl,
};
