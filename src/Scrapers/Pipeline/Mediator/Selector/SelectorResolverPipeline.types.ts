/**
 * Type-only sibling for SelectorResolverPipeline.
 */

import type { Frame, Page } from 'playwright-core';

import type { IFieldConfig, SelectorCandidate } from '../../../Base/Config/LoginConfig.js';

/** List of tried selectors for diagnostics. */
type TriedList = string[];

/**
 * The resolved location of a login field — always returned, never throws.
 * Check `isResolved` before using `selector` / `context`.
 */
interface IFieldContext {
  /** Whether resolution found a match. */
  isResolved: boolean;
  /** Resolved selector (empty when not resolved). */
  selector: string;
  /** Owning Page/Frame for the match. */
  context: Page | Frame;
  /** Where the match came from. */
  resolvedVia: 'bankConfig' | 'wellKnown' | 'heuristic' | 'notResolved';
  /** Which round produced the match. */
  round: 'iframe' | 'mainPage' | 'heuristic' | 'notResolved';
  /** Which SelectorCandidate kind actually matched (additive, optional). */
  resolvedKind?: SelectorCandidate['kind'];
  /** Diagnostic message — populated when isResolved is false. */
  message?: string;
}

/**
 * Internal match result — callers add isResolved, resolvedVia, round.
 * `selector` is empty string when not found (never null).
 */
interface IFieldMatch {
  /** Resolved selector (empty when not found). */
  selector: string;
  /** Owning Page/Frame. */
  context: Page | Frame;
  /** Optional SelectorCandidate kind. */
  kind?: SelectorCandidate['kind'];
}

/** All inputs needed to resolve a single login field. */
interface IResolveAllOpts {
  /** Playwright Page or Frame to search in. */
  pageOrFrame: Page | Frame;
  /** Field configuration (credential key + selector list). */
  field: IFieldConfig;
  /** URL of the page (for diagnostic messages). */
  pageUrl: string;
  /** Bank-specific candidate list. */
  bankCandidates: SelectorCandidate[];
  /** Well-known fallback candidate list. */
  wellKnownCandidates: SelectorCandidate[];
  /** Pre-cached child frames from stepParseLoginPage. */
  cachedFrames?: Frame[];
}
export type { IFieldContext, IFieldMatch, IResolveAllOpts, TriedList };
