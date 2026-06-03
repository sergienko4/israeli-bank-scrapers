/**
 * Type-only sibling for SelectorResolver.
 */

import type { Frame, Page } from 'playwright-core';

import type { IFieldConfig, SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import type { Brand } from '../../Types/Brand.js';

/** XPath-safe quoted string literal. */
type XpathLiteralStr = Brand<string, 'XpathLiteralStr'>;

/** Playwright-compatible CSS or XPath selector. */
type PlaywrightSelector = Brand<string, 'PlaywrightSelector'>;

/** Resolved credential dictionary key. */
type CredentialKey = Brand<string, 'CredentialKey'>;

/** Internal probe result — selector + which kind matched. */
interface IProbeResult {
  /** Resolved CSS/XPath selector (empty when no match). */
  css: string;
  /** Candidate kind that produced the match. */
  kind: SelectorCandidate['kind'];
}

/** Options for resolving with pre-cached frames from stepParseLoginPage. */
interface ICachedResolveOpts {
  /** Page or Frame to search in. */
  pageOrFrame: Page | Frame;
  /** Field configuration. */
  field: IFieldConfig;
  /** Current page URL (for diagnostics). */
  pageUrl: string;
  /** Pre-cached child frames. */
  cachedFrames: Frame[];
}

/** Options for resolving a post-login dashboard selector. */
interface IDashboardFieldOpts {
  /** Page or Frame to search in. */
  pageOrFrame: Page | Frame;
  /** Credential key (e.g. 'accountNumber'). */
  fieldKey: string;
  /** Bank-specific candidate list. */
  bankCandidates: SelectorCandidate[];
  /** Current page URL (for diagnostics). */
  pageUrl: string;
}
export type {
  CredentialKey,
  ICachedResolveOpts,
  IDashboardFieldOpts,
  IProbeResult,
  PlaywrightSelector,
  XpathLiteralStr,
};
