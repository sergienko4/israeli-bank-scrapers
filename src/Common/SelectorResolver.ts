import { type Frame, type Page } from 'playwright-core';

import { type IFieldConfig, type SelectorCandidate } from '../Scrapers/Base/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/Config/ScraperConfig.js';
import {
  CANDIDATE_TIMEOUT_MS,
  CREDENTIAL_KEY_MAP,
  MIN_ID_LENGTH,
} from './Config/SelectorResolverConfig.js';
import { getDebug } from './Debug.js';
import { resolveLabelText, resolveTextContent } from './SelectorLabelStrategies.js';
import {
  buildNotFoundContext,
  type IFieldContext,
  type IResolveAllOpts,
  probeIframes,
  probeMainPage,
} from './SelectorResolverPipeline.js';

export type { IFieldContext } from './SelectorResolverPipeline.js'; // re-export

const LOG = getDebug('selector-resolver');

/** Global login-field fallback dictionary — sourced from central ScraperConfig. */
const WELL_KNOWN_SELECTORS = SCRAPER_CONFIGURATION.wellKnownSelectors as Record<
  string,
  SelectorCandidate[]
>;

/** Global dashboard-field fallback dictionary — sourced from central ScraperConfig. */
const WELL_KNOWN_DASHBOARD_SELECTORS = SCRAPER_CONFIGURATION.wellKnownDashboardSelectors as Record<
  string,
  SelectorCandidate[]
>;

/**
 * Escape a string for safe use as an XPath string literal.
 * Handles values containing single quotes, double quotes, or both.
 * @param value - The raw string value.
 * @returns XPath-safe quoted string.
 */
export function toXpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  const parts = value.split('"').map(part => `"${part}"`);
  return `concat(${parts.join(", '\"', ")})`;
}

/**
 * Build XPath for clickableText — innermost element with text.
 * @param value - The visible text to match.
 * @returns Playwright-compatible XPath selector.
 */
function clickableTextXpath(value: string): string {
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
export function candidateToCss(candidate: SelectorCandidate): string {
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
export function extractCredentialKey(selector: string): string {
  const id = /^#([\w-]+)/.exec(selector)?.[1] ?? selector;
  const lower = id.toLowerCase();
  const directMatch = CREDENTIAL_KEY_MAP[lower];
  if (directMatch) return directMatch;
  for (const [key, val] of Object.entries(CREDENTIAL_KEY_MAP)) {
    if (lower.includes(key)) return val;
  }
  if (lower.startsWith('id') && lower.length <= MIN_ID_LENGTH) return 'id';
  return id;
}

/**
 * Query for an element with a timeout to avoid hanging on detached frames.
 * @param ctx - The Page or Frame context to query in.
 * @param css - The CSS or XPath selector to look for.
 * @returns Whether the element was found within the timeout.
 */
export async function queryWithTimeout(ctx: Page | Frame, css: string): Promise<boolean> {
  const state = { timer: 0 as unknown as ReturnType<typeof globalThis.setTimeout> };
  const timedOutSentinel = 'timedOut' as const;
  const el = await Promise.race([
    ctx.$(css),
    new Promise<typeof timedOutSentinel>(resolve => {
      state.timer = globalThis.setTimeout(() => {
        resolve(timedOutSentinel);
      }, CANDIDATE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(state.timer);
  return el !== timedOutSentinel && el !== null;
}

/** Internal probe result — selector + which kind matched. */
interface IProbeResult {
  css: string;
  kind: SelectorCandidate['kind'];
}

/**
 * Log that a candidate was skipped due to cross-origin or detached frame.
 * @param candidate - The selector candidate that was skipped.
 * @returns True after logging completes.
 */
function debugCandidateSkipped(candidate: SelectorCandidate): boolean {
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
async function probeStandardCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  const css = candidateToCss(candidate);
  const isFound = await queryWithTimeout(ctx, css);
  if (isFound) {
    LOG.debug('resolved %s "%s" → %s', candidate.kind, candidate.value, css);
    return { css, kind: candidate.kind };
  }
  LOG.debug('candidate %s "%s" → NOT FOUND', candidate.kind, candidate.value);
  return { css: '', kind: candidate.kind };
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
    if (candidate.kind === 'labelText') return await probeLabelText(ctx, candidate);
    if (candidate.kind === 'textContent') return await probeTextContent(ctx, candidate);
    if (candidate.kind === 'clickableText') return await probeClickableText(ctx, candidate);
    return await probeStandardCandidate(ctx, candidate);
  } catch {
    debugCandidateSkipped(candidate);
  }
  return { css: '', kind: candidate.kind };
}

/**
 * Probe a clickableText candidate: find innermost element with text and return it.
 * Any visible element is clickable — we don't assume a specific tag.
 * @param ctx - The Page or Frame context to query in.
 * @param candidate - The clickableText selector candidate.
 * @returns The probe result targeting the first visible text element.
 */
async function probeClickableText(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<IProbeResult> {
  const text = candidate.value;
  const lit = toXpathLiteral(text);
  const baseXpath = [
    'xpath=//*[not(self::script)',
    'and not(self::style)',
    `and contains(., ${lit})`,
    `and not(.//*[contains(., ${lit})])]`,
  ].join(' ');
  const isFound = await queryWithTimeout(ctx, baseXpath);
  if (!isFound) return { css: '', kind: 'clickableText' };
  LOG.debug('resolved clickableText "%s" → %s', text, baseXpath);
  return { css: baseXpath, kind: 'clickableText' };
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
  const emptyResult: IProbeResult = { css: '', kind: 'css' };
  const actions = candidates.map(
    (candidate): (() => Promise<IProbeResult>) =>
      () =>
        probeCandidate(ctx, candidate),
  );
  const initialValue: Promise<IProbeResult> = Promise.resolve(emptyResult);
  const result = await actions.reduce<Promise<IProbeResult>>(async (previousPromise, action) => {
    const previous = await previousPromise;
    if (previous.css) return previous;
    return action();
  }, initialValue);
  return result;
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
  pageUrl: string;
  cachedFrames: Frame[];
}

/** Options for resolving a post-login dashboard selector. */
export interface IDashboardFieldOpts {
  pageOrFrame: Page | Frame;
  fieldKey: string;
  bankCandidates: SelectorCandidate[];
  pageUrl: string;
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
  if (isPage(pageOrFrame)) {
    const iframeResult = await probeIframes(pageOrFrame, opts);
    if ('isResolved' in iframeResult) return iframeResult;
  }
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
  pageUrl: string,
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
  const wellKnownCandidates = WELL_KNOWN_DASHBOARD_SELECTORS[fieldKey] ?? [];
  return resolveAll({
    pageOrFrame,
    field: { credentialKey: fieldKey, selectors: [...bankCandidates] },
    pageUrl,
    bankCandidates: [...bankCandidates],
    wellKnownCandidates: [...wellKnownCandidates],
  });
}
