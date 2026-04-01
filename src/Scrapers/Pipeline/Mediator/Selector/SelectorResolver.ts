import { type Frame, type Page } from 'playwright-core';

import { type IFieldConfig, type SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import {
  WELL_KNOWN_DASHBOARD_SELECTORS,
  WELL_KNOWN_LOGIN_SELECTORS,
} from '../../../Registry/WellKnownSelectors.js';
import { RACE_TIMED_OUT, raceTimeout } from '../../Phases/Timing/Waiting.js';
import { getDebug } from '../../Types/Debug.js';
import {
  isClickableElement,
  isFillableInput,
  resolveLabelText,
  resolveTextContent,
} from './SelectorLabelStrategies.js';

/** CSS/XPath selector string. */
type CssStr = string;
/** XPath literal string. */
type XpathStr = string;
/** Credential field key. */
type FieldKey = string;
/** Page URL for diagnostics. */
type PageUrl = string;
/** Whether a DOM query found an element. */
type IsFound = boolean;
/** Candidate kind identifier. */
type CandidateKind = string;
import {
  CANDIDATE_TIMEOUT_MS,
  CREDENTIAL_KEY_MAP,
  MIN_ID_LENGTH,
} from './SelectorResolverConfig.js';
import {
  buildNotFoundContext,
  type IFieldContext,
  type IResolveAllOpts,
  probeIframes,
  probeMainPage,
} from './SelectorResolverPipeline.js';

export type { IFieldContext } from './SelectorResolverPipeline.js'; // re-export

const LOG = getDebug('selector-resolver');

/** Global login-field fallback dictionary. */
const WELL_KNOWN_SELECTORS = WELL_KNOWN_LOGIN_SELECTORS as Record<string, SelectorCandidate[]>;

/**
 * Escape a string for safe use as an XPath string literal.
 * Handles values containing single quotes, double quotes, or both.
 * @param value - The raw string value.
 * @returns XPath-safe quoted string.
 */
export function toXpathLiteral(value: XpathStr): XpathStr {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  const parts = value.split('"').map((part): XpathStr => `"${part}"`);
  return `concat(${parts.join(", '\"', ")})`;
}

/**
 * Build XPath for clickableText — innermost element with text.
 * @param value - The visible text to match.
 * @returns Playwright-compatible XPath selector.
 */
function clickableTextXpath(value: CssStr): XpathStr {
  const lit = toXpathLiteral(value);
  return [
    'xpath=//*[not(self::script)',
    'and not(self::style)',
    `and contains(., ${lit})`,
    `and not(.//*[contains(., ${lit})])]`,
  ].join(' ');
}

/**
 * Convert a SelectorCandidate to a Playwright-compatible selector.
 * @param candidate - The selector candidate to convert.
 * @returns A Playwright-compatible CSS or XPath selector string.
 */
export function candidateToCss(candidate: SelectorCandidate): CssStr {
  const v = candidate.value;
  const lit = toXpathLiteral(v);
  if (candidate.kind === 'clickableText') return clickableTextXpath(v);
  if (candidate.kind === 'labelText') return `xpath=//label[contains(., ${lit})]`;
  if (candidate.kind === 'textContent') return `xpath=//*[contains(text(), ${lit})]`;
  if (candidate.kind === 'css') return v;
  if (candidate.kind === 'placeholder') return `input[placeholder*="${v}"]`;
  if (candidate.kind === 'ariaLabel') return `input[aria-label="${v}"]`;
  if (candidate.kind === 'name') return `[name="${v}"]`;
  return `xpath=${v}`;
}

/**
 * True when `pageOrFrame` is a full Page (has `frames()` method).
 * @param pageOrFrame - The Playwright Page or Frame to check.
 * @returns Whether the argument is a Page instance.
 */
export function isPage(pageOrFrame: Page | Frame): pageOrFrame is Page {
  return 'frames' in pageOrFrame && typeof (pageOrFrame as unknown as Page).frames === 'function';
}

/**
 * Extract the most likely WELL_KNOWN_SELECTORS key from a CSS selector string.
 * @param selector - A CSS selector string such as '#username' or '#tzId'.
 * @returns The normalized credential key (e.g. 'username', 'password', 'id', 'num').
 */
export function extractCredentialKey(selector: CssStr): FieldKey {
  const id = /^#([\w-]+)/.exec(selector)?.[1] ?? selector;
  const lower = id.toLowerCase();
  const directMatch = CREDENTIAL_KEY_MAP[lower];
  if (directMatch) return directMatch;
  const partialMatch = findPartialCredentialMatch(lower);
  if (partialMatch) return partialMatch;
  if (lower.startsWith('id') && lower.length <= MIN_ID_LENGTH) return 'id';
  return id;
}

/**
 * Search CREDENTIAL_KEY_MAP for a key that appears as a substring of the input.
 * @param lower - The lowercased identifier to search within.
 * @returns The matched credential key, or empty string if none found.
 */
function findPartialCredentialMatch(lower: CssStr): FieldKey {
  const entries = Object.entries(CREDENTIAL_KEY_MAP);
  const match = entries.find(([key]): IsFound => lower.includes(key));
  if (!match) return String();
  return match[1];
}

/**
 * Query for an element with a timeout to avoid hanging on detached frames.
 * @param ctx - The Page or Frame context to query in.
 * @param css - The CSS or XPath selector to look for.
 * @returns Whether the element was found within the timeout.
 */
export async function queryWithTimeout(ctx: Page | Frame, css: CssStr): Promise<IsFound> {
  const queryPromise = ctx.$(css);
  const el = await raceTimeout(CANDIDATE_TIMEOUT_MS, queryPromise);
  return el !== RACE_TIMED_OUT && el !== null;
}

/** Internal probe result — selector + which kind matched. */
interface IProbeResult {
  css: CssStr;
  kind: SelectorCandidate['kind'];
}

/**
 * Log that a candidate was skipped due to cross-origin or detached frame.
 * @param candidate - The selector candidate that was skipped.
 * @returns True after logging completes.
 */
function debugCandidateSkipped(candidate: SelectorCandidate): IsFound {
  LOG.debug(
    'candidate %s "%s" → skipped (cross-origin / detached frame)',
    candidate.kind,
    candidate.value,
  );
  return true;
}

/**
 * Probe a labelText candidate in the given context.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The labelText selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeLabelText(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  const css = candidateToCss(candidate);
  const resolved = await resolveLabelText({
    ctx,
    labelXpath: css,
    labelValue: candidate.value,
    queryFn: queryWithTimeout,
  });
  return { css: resolved, kind: 'labelText' };
}

/**
 * Probe a textContent candidate: find visible text, walk up DOM to interactive ancestor.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The textContent selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeTextContent(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  const resolved = await resolveTextContent(ctx, candidate.value, queryWithTimeout);
  return { css: resolved, kind: 'textContent' };
}

/**
 * Probe a standard (non-label, non-textContent) candidate via direct query.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
/** Candidate kinds that target input fields — must pass isFillableInput check. */
const FILLABLE_KINDS = new Set(['name', 'ariaLabel']);

/**
 * Check if a found candidate is fillable (for input-targeting kinds only).
 * @param ctx - Page or Frame context.
 * @param css - Resolved CSS selector.
 * @param kind - Candidate kind.
 * @returns True if fillable or not an input-targeting kind.
 */
async function checkFillable(
  ctx: Page | Frame,
  css: CssStr,
  kind: CandidateKind,
): Promise<IsFound> {
  if (!FILLABLE_KINDS.has(kind)) return true;
  return isFillableInput(ctx, css).catch((): IsFound => true);
}

/**
 * Probe a standard (non-label, non-textContent) candidate via direct query.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeStandardCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  const css = candidateToCss(candidate);
  const isFound = await queryWithTimeout(ctx, css);
  if (!isFound) {
    LOG.debug('candidate %s "%s" → NOT FOUND', candidate.kind, candidate.value);
    return { css: '', kind: candidate.kind };
  }
  const isFillable = await checkFillable(ctx, css, candidate.kind);
  if (!isFillable) {
    LOG.debug('candidate %s "%s" → NOT FILLABLE', candidate.kind, candidate.value);
    return { css: '', kind: candidate.kind };
  }
  LOG.debug('resolved %s "%s" → %s', candidate.kind, candidate.value, css);
  return { css, kind: candidate.kind };
}

/**
 * Probe a single candidate in the given context.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The selector candidate to probe.
 * @returns The probe result with css and kind, or empty result if not found.
 */
async function probeCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  try {
    return await dispatchProbe(ctx, candidate);
  } catch {
    debugCandidateSkipped(candidate);
  }
  return { css: '', kind: candidate.kind };
}

/** Map from candidate kind to a specialized probe function. */
const PROBE_DISPATCH: Partial<
  Record<
    SelectorCandidate['kind'],
    (ctx: Page | Frame, c: SelectorCandidate) => Promise<IProbeResult>
  >
> = {
  labelText: probeLabelText,
  textContent: probeTextContent,
  clickableText: probeClickableText,
};

/**
 * Dispatch to the appropriate probe function based on candidate kind.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The selector candidate to probe.
 * @returns The probe result with css and kind.
 */
async function dispatchProbe(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  const specialized = PROBE_DISPATCH[candidate.kind];
  if (specialized) return specialized(ctx, candidate);
  return probeStandardCandidate(ctx, candidate);
}

/**
 * Probe a clickableText candidate: find innermost element with text and return it.
 * Any visible element is clickable — we don't assume a specific tag.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The clickableText selector candidate.
 * @returns The probe result targeting the first visible text element.
 */
/**
 * Build deepest-text XPath for visible text matching.
 * @param text - Visible text to search for.
 * @returns XPath selector string.
 */
function buildTextXpath(text: CssStr): XpathStr {
  const lit = toXpathLiteral(text);
  return [
    'xpath=//*[not(self::script)',
    'and not(self::style)',
    `and contains(., ${lit})`,
    `and not(.//*[contains(., ${lit})])]`,
  ].join(' ');
}

/**
 * Probe for clickable element matching visible text.
 * @param ctx - Playwright Page or Frame.
 * @param candidate - Selector candidate with text value.
 * @returns Probe result with resolved XPath or empty css.
 */
async function probeClickableText(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  const xpath = buildTextXpath(candidate.value);
  const isFound = await queryWithTimeout(ctx, xpath);
  if (!isFound) return { css: '', kind: 'clickableText' };
  const hasClick = await isClickableElement(ctx, xpath).catch((): IsFound => true);
  if (!hasClick) return { css: '', kind: 'clickableText' };
  LOG.debug('resolved clickableText "%s" → %s', candidate.value, xpath);
  return { css: xpath, kind: 'clickableText' };
}

/**
 * Internal: try each candidate, return first match with kind metadata.
 * @param ctx - The Page or Frame context to query in.
 * @param candidates - The ordered list of selector candidates to try.
 * @returns The first matching probe result, or empty result if none matched.
 */
export async function tryInContextInternal(
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
): Promise<IProbeResult> {
  const actions = buildProbeActions(ctx, candidates);
  return reduceProbeActions(actions);
}

/** Empty probe result — no candidate matched. */
const EMPTY_PROBE: IProbeResult = { css: '', kind: 'css' };

/**
 * Build lazy probe actions for each candidate.
 * @param ctx - The Page or Frame context to query in.
 * @param candidates - The ordered list of selector candidates.
 * @returns Array of lazy probe action factories.
 */
function buildProbeActions(
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
): (() => Promise<IProbeResult>)[] {
  return candidates.map(
    (candidate): (() => Promise<IProbeResult>) =>
      (): Promise<IProbeResult> =>
        probeCandidate(ctx, candidate),
  );
}

/**
 * Reduce probe actions sequentially, returning the first match.
 * @param actions - The lazy probe action factories.
 * @returns The first matching probe result, or empty result.
 */
function reduceProbeActions(actions: (() => Promise<IProbeResult>)[]): Promise<IProbeResult> {
  const seed = Promise.resolve(EMPTY_PROBE);
  return actions.reduce<Promise<IProbeResult>>(async (prev, action): Promise<IProbeResult> => {
    const result = await prev;
    if (result.css) return result;
    return action();
  }, seed);
}

/**
 * Try each candidate on `ctx` with a per-candidate timeout.
 * @param ctx - The Page or Frame context to query in.
 * @param candidates - The ordered list of selector candidates to try.
 * @returns The first matching CSS selector string, or empty string if none matched.
 */
export async function tryInContext(
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
): Promise<string> {
  const result = await tryInContextInternal(ctx, candidates);
  return result.css || '';
}

/** Options for resolving with pre-cached frames from stepParseLoginPage. */
export interface ICachedResolveOpts {
  pageOrFrame: Page | Frame;
  field: IFieldConfig;
  pageUrl: PageUrl;
  cachedFrames: Frame[];
}

/** Options for resolving a post-login dashboard selector. */
export interface IDashboardFieldOpts {
  pageOrFrame: Page | Frame;
  fieldKey: FieldKey;
  bankCandidates: SelectorCandidate[];
  pageUrl: PageUrl;
}

/**
 * Run the full resolution pipeline: iframes first, then main context.
 * @param opts - The resolve options containing page, field, candidates, and page URL.
 * @returns A IFieldContext with resolution details.
 */
async function resolveAll(opts: IResolveAllOpts): Promise<IFieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates, wellKnownCandidates } = opts;
  const bankCount = String(bankCandidates.length);
  const wellKnownCount = String(wellKnownCandidates.length);
  LOG.debug(
    'resolving "%s": %sb+%swk on %s',
    field.credentialKey,
    bankCount,
    wellKnownCount,
    pageUrl,
  );
  const iframeResult = isPage(pageOrFrame) && (await probeIframes(pageOrFrame, opts));
  if (iframeResult && 'isResolved' in iframeResult) return iframeResult;
  const mainResult = await probeMainPage(opts);
  if ('isResolved' in mainResult) return mainResult;
  return buildNotFoundContext(opts);
}

/**
 * Resolve a login field to a selector + context pair using the full pipeline.
 * @param pageOrFrame - The Playwright Page or Frame to search in.
 * @param field - The field configuration with credential key and selectors.
 * @param pageUrl - The current page URL (for diagnostics).
 * @returns A IFieldContext with resolution details.
 */
export async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: IFieldConfig,
  pageUrl: PageUrl,
): Promise<IFieldContext> {
  return resolveAll({
    pageOrFrame,
    field,
    pageUrl,
    bankCandidates: [...field.selectors],
    wellKnownCandidates: [...(WELL_KNOWN_SELECTORS[field.credentialKey] ?? [])],
  });
}

/**
 * Resolve with pre-cached frames from stepParseLoginPage.
 * @param opts - The cached resolve options including page, field, URL, and cached frames.
 * @returns A IFieldContext with resolution details.
 */
export async function resolveFieldWithCache(opts: ICachedResolveOpts): Promise<IFieldContext> {
  return resolveAll({
    ...opts,
    bankCandidates: [...opts.field.selectors],
    wellKnownCandidates: [...(WELL_KNOWN_SELECTORS[opts.field.credentialKey] ?? [])],
  });
}

/**
 * Resolve a dashboard data field using the same pipeline as login resolution.
 * @param opts - The dashboard field options including page, field key, candidates, and URL.
 * @returns A IFieldContext with resolution details.
 */
export async function resolveDashboardField(opts: IDashboardFieldOpts): Promise<IFieldContext> {
  const { pageOrFrame, fieldKey, bankCandidates, pageUrl } = opts;
  const dashboardSelectors = WELL_KNOWN_DASHBOARD_SELECTORS as Record<string, SelectorCandidate[]>;
  const wellKnownCandidates: SelectorCandidate[] = dashboardSelectors[fieldKey] ?? [];
  return resolveAll({
    pageOrFrame,
    field: { credentialKey: fieldKey, selectors: [...bankCandidates] },
    pageUrl,
    bankCandidates: [...bankCandidates],
    wellKnownCandidates: [...wellKnownCandidates],
  });
}
