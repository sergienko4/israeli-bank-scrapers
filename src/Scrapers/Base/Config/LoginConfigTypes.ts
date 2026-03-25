import type { Page } from 'playwright-core';

/** What to act on after resolving an element by text. */
export type SelectorTarget = 'self' | 'input' | 'parent' | 'href';

/**
 * A single way to locate an element on the page.
 * Multiple candidates are tried in order until one resolves.
 *
 * Optional fields:
 * - target: what to act on after text resolution (default: 'self')
 * - match:  regex pattern to validate the resolved element before acting
 */
export type SelectorCandidate =
  | { kind: 'labelText'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'textContent'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'clickableText'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'css'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'placeholder'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'ariaLabel'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'name'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'xpath'; value: string; target?: SelectorTarget; match?: string }
  | { kind: 'regex'; value: string; target?: SelectorTarget; match?: string };

/**
 * Get the target for a candidate — defaults to 'self' when absent.
 * @param candidate - The selector candidate.
 * @returns The target: 'self' | 'input' | 'parent' | 'href'.
 */
export function getCandidateTarget(candidate: SelectorCandidate): SelectorTarget {
  return candidate.target ?? 'self';
}

/**
 * Validate a resolved value against the candidate's match pattern.
 * Uses case-insensitive regex for Hebrew/English compatibility.
 * @param candidate - The selector candidate with optional match.
 * @param value - The resolved value to validate (href, text, etc.).
 * @returns True if no match field, or value matches the pattern.
 */
export function validateCandidateMatch(candidate: SelectorCandidate, value: string): boolean {
  if (!candidate.match) return true;
  const pattern = new RegExp(candidate.match, 'i');
  return pattern.test(value);
}

/** OTP step config — DOM (selector-driven) or API (class override) */
export type OtpConfig =
  | {
      kind: 'dom';
      triggerSelectors?: SelectorCandidate[]; // optional "send code" button
      inputSelectors: SelectorCandidate[]; // where to type the OTP code
      submitSelectors: SelectorCandidate[]; // confirm button
      longTermTokenSupported: boolean;
    }
  | {
      kind: 'api'; // handled entirely in the scraper class (e.g. OneZero)
    };

/** A single login result condition: URL string, regex, or sync/async page predicate */
type ResultConditionFn = (opts?: { page?: Page }) => boolean | Promise<boolean>;
export type ResultCondition = string | RegExp | ResultConditionFn;
