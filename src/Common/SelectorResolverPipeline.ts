import { type Frame, type Page } from 'playwright-core';

import { type IFieldConfig, type SelectorCandidate } from '../Scrapers/Base/Config/LoginConfig.js';
import { getDebug } from './Debug.js';
import { tryInContextInternal } from './SelectorResolver.js';

const LOG = getDebug('selector-resolver-pipeline');

/**
 * The resolved location of a login field — always returned, never throws.
 * Check `isResolved` before using `selector` / `context`.
 */
export interface IFieldContext {
  isResolved: boolean;
  selector: string;
  context: Page | Frame;
  resolvedVia: 'bankConfig' | 'wellKnown' | 'notResolved';
  round: 'iframe' | 'mainPage' | 'notResolved';
  /** Which SelectorCandidate kind actually matched (additive, optional). */
  resolvedKind?: SelectorCandidate['kind'];
  /** Diagnostic message — populated when isResolved is false. */
  message?: string;
}

/**
 * Internal match result — callers add isResolved, resolvedVia, round.
 * `selector` is empty string when not found (never null).
 */
export interface IFieldMatch {
  selector: string;
  context: Page | Frame;
  kind?: SelectorCandidate['kind'];
}

/** All inputs needed to resolve a single login field. */
export interface IResolveAllOpts {
  pageOrFrame: Page | Frame;
  field: IFieldConfig;
  pageUrl: string;
  bankCandidates: SelectorCandidate[];
  wellKnownCandidates: SelectorCandidate[];
  /** Pre-cached child frames from stepParseLoginPage. */
  cachedFrames?: Frame[];
}

/**
 * Convert a field match to a fully populated IFieldContext.
 * @param match - The field match containing selector and context.
 * @param via - Whether resolved via bankConfig or wellKnown.
 * @param round - Whether resolved in iframe or mainPage.
 * @returns A IFieldContext with isResolved=true.
 */
function toFieldContext(
  match: IFieldMatch,
  via: IFieldContext['resolvedVia'],
  round: IFieldContext['round'],
): IFieldContext {
  return {
    isResolved: true,
    selector: match.selector,
    context: match.context,
    resolvedVia: via,
    round,
    resolvedKind: match.kind,
  };
}

/**
 * Get the page title safely, returning '(unknown)' on failure.
 * @param pageOrFrame - The Page or Frame to get the title from.
 * @returns The page title string.
 */
async function getPageTitle(pageOrFrame: Page | Frame): Promise<string> {
  try {
    return await (pageOrFrame as Page).title();
  } catch {
    return '(unknown)';
  }
}

/** Context for building a not-found diagnostic message. */
interface INotFoundContext {
  credentialKey: string;
  pageUrl: string;
  tried: string[];
  pageTitle: string;
}

/**
 * Build a human-readable diagnostic message when a field cannot be found.
 * @param ctx - The not-found context with credential key, URL, and tried candidates.
 * @returns A multiline diagnostic message string.
 */
function buildNotFoundMessage(ctx: INotFoundContext): string {
  const { credentialKey, pageUrl, tried, pageTitle } = ctx;
  const triedCount = String(tried.length);
  return (
    `Could not find '${credentialKey}' field on ${pageUrl}\n` +
    `Tried ${triedCount} candidates:\n` +
    tried.join('\n') +
    `\nPage title: "${pageTitle}"\n` +
    'This usually means the bank redesigned their login page.\n' +
    'Run: npx ts-node scripts/inspect-bank-login.ts' +
    ` --url '${pageUrl}' to re-detect selectors.`
  );
}

/**
 * Log all tried candidates when resolution fails.
 * @param key - The credential key that failed to resolve.
 * @param url - The page URL where resolution was attempted.
 * @param tried - The formatted candidate strings that were tried.
 * @returns True after logging completes.
 */
function logTriedCandidates(key: string, url: string, tried: string[]): boolean {
  LOG.debug('FAILED "%s" on %s (%d tried)', key, url, tried.length);
  for (const line of tried) LOG.debug(line);
  return true;
}

/**
 * Format tried candidates into diagnostic strings.
 * @param bankCandidates - The bank-specific selector candidates.
 * @param wellKnownCandidates - The global fallback selector candidates.
 * @returns An array of formatted diagnostic strings.
 */
function formatTriedCandidates(
  bankCandidates: SelectorCandidate[],
  wellKnownCandidates: SelectorCandidate[],
): string[] {
  return [...bankCandidates, ...wellKnownCandidates].map(
    candidate => `  ${candidate.kind} "${candidate.value}" → NOT found`,
  );
}

/**
 * Build a not-found IFieldContext with diagnostic details.
 * @param opts - The resolve options containing page, field, and candidates.
 * @returns A IFieldContext with isResolved=false and a diagnostic message.
 */
export async function buildNotFoundContext(opts: IResolveAllOpts): Promise<IFieldContext> {
  const { pageOrFrame, field, pageUrl } = opts;
  const tried = formatTriedCandidates(opts.bankCandidates, opts.wellKnownCandidates);
  logTriedCandidates(field.credentialKey, pageUrl, tried);
  const pageTitle = await getPageTitle(pageOrFrame);
  const msg = buildNotFoundMessage({
    credentialKey: field.credentialKey,
    pageUrl,
    tried,
    pageTitle,
  });
  LOG.debug(msg);
  return buildNotResolvedResult(pageOrFrame, msg);
}

/**
 * Create a not-resolved IFieldContext with a diagnostic message.
 * @param context - The Page or Frame where resolution was attempted.
 * @param message - The diagnostic message explaining why resolution failed.
 * @returns A IFieldContext with isResolved=false.
 */
function buildNotResolvedResult(context: Page | Frame, message: string): IFieldContext {
  return {
    isResolved: false,
    selector: '',
    context,
    resolvedVia: 'notResolved',
    round: 'notResolved',
    message,
  };
}

/**
 * Try a single frame for matching candidates.
 * @param frame - The iframe to search in.
 * @param allCandidates - The candidates to try.
 * @returns A field match result (selector is empty string if not found).
 */
async function tryFrame(frame: Frame, allCandidates: SelectorCandidate[]): Promise<IFieldMatch> {
  const found = await tryInContextInternal(frame, allCandidates);
  if (found.css) {
    const frameUrl = frame.url();
    LOG.debug('Round 1: resolved in iframe %s → %s', frameUrl, found.css);
    return { selector: found.css, context: frame, kind: found.kind };
  }
  return { selector: '', context: frame };
}

/**
 * Get child frames from a page, using cached frames if available.
 * @param page - The Playwright Page to get frames from.
 * @param cachedFrames - Optional pre-cached child frames.
 * @returns The list of child frames.
 */
function getChildFrames(page: Page, cachedFrames?: Frame[]): Frame[] {
  const mainFrame = page.mainFrame();
  return cachedFrames ?? page.frames().filter(f => f !== mainFrame);
}

/**
 * Reduce frame actions sequentially, returning first match.
 * @param actions - The frame probe actions to execute.
 * @param emptyMatch - The fallback empty match result.
 * @returns The first matching field, or the empty match.
 */
function reduceFrameActions(
  actions: (() => Promise<IFieldMatch>)[],
  emptyMatch: IFieldMatch,
): Promise<IFieldMatch> {
  const initialValue: Promise<IFieldMatch> = Promise.resolve(emptyMatch);
  return actions.reduce<Promise<IFieldMatch>>(async (prev, action) => {
    const result = await prev;
    if (result.selector) return result;
    return action();
  }, initialValue);
}

/**
 * Search child iframes for a matching selector candidate.
 * @param page - The Playwright Page to search frames in.
 * @param allCandidates - The ordered list of selector candidates to try.
 * @param cachedFrames - Optional pre-cached child frames.
 * @returns A field match result (selector is empty string if not found).
 */
export async function searchInChildFrames(
  page: Page,
  allCandidates: SelectorCandidate[],
  cachedFrames?: Frame[],
): Promise<IFieldMatch> {
  const childFrames = getChildFrames(page, cachedFrames);
  if (childFrames.length > 0) LOG.debug('Round 1: searching %d iframe(s)', childFrames.length);
  const actions = childFrames.map(
    (frame): (() => Promise<IFieldMatch>) =>
      () =>
        tryFrame(frame, allCandidates),
  );
  return reduceFrameActions(actions, { selector: '', context: page });
}

/**
 * Resolve a field in the main page context (Round 2).
 * @param pageOrFrame - The Page or Frame context to query in.
 * @param allCandidates - The ordered list of selector candidates to try.
 * @param credentialKey - The credential key being resolved (for logging).
 * @returns A field match result (selector is empty string if not found).
 */
export async function resolveInMainContext(
  pageOrFrame: Page | Frame,
  allCandidates: SelectorCandidate[],
  credentialKey: string,
): Promise<IFieldMatch> {
  LOG.debug('Round 2: searching main page');
  const main = await tryInContextInternal(pageOrFrame, allCandidates);
  if (!main.css) return { selector: '', context: pageOrFrame };
  LOG.debug('Round 2: resolved "%s" → %s', credentialKey, main.css);
  return { selector: main.css, context: pageOrFrame, kind: main.kind };
}

/** Options for trying a candidate group in child frames. */
interface IIframeGroupOpts {
  page: Page;
  candidates: SelectorCandidate[];
  via: IFieldContext['resolvedVia'];
  cachedFrames?: Frame[];
}

/**
 * Try a single candidate group in child frames.
 * @param opts - The iframe group options.
 * @returns A IFieldContext if found, or empty field match.
 */
async function tryIframeGroup(opts: IIframeGroupOpts): Promise<IFieldContext | IFieldMatch> {
  const { page, candidates, via, cachedFrames } = opts;
  if (candidates.length === 0) return { selector: '', context: page };
  const result = await searchInChildFrames(page, candidates, cachedFrames);
  if (result.selector) return toFieldContext(result, via, 'iframe');
  return { selector: '', context: page };
}

/**
 * Probe all child iframes for a matching field.
 * @param page - The Playwright Page to search frames in.
 * @param opts - The resolve options containing candidates and cached frames.
 * @returns A IFieldContext if found in an iframe, or empty field match.
 */
export async function probeIframes(
  page: Page,
  opts: IResolveAllOpts,
): Promise<IFieldContext | IFieldMatch> {
  const { bankCandidates, wellKnownCandidates, cachedFrames } = opts;
  const bankResult = await tryIframeGroup({
    page,
    candidates: bankCandidates,
    via: 'bankConfig',
    cachedFrames,
  });
  if ('isResolved' in bankResult) return bankResult;
  const wkResult = await tryIframeGroup({
    page,
    candidates: wellKnownCandidates,
    via: 'wellKnown',
    cachedFrames,
  });
  return wkResult;
}

/** Options for trying a candidate group in the main page context. */
interface IMainGroupOpts {
  ctx: Page | Frame;
  candidates: SelectorCandidate[];
  credentialKey: string;
  via: IFieldContext['resolvedVia'];
}

/**
 * Try a single candidate group in the main page context.
 * @param opts - The main group options.
 * @returns A IFieldContext if found, or empty field match.
 */
async function tryMainGroup(opts: IMainGroupOpts): Promise<IFieldContext | IFieldMatch> {
  const { ctx, candidates, credentialKey, via } = opts;
  if (candidates.length === 0) return { selector: '', context: ctx };
  const result = await resolveInMainContext(ctx, candidates, credentialKey);
  if (result.selector) return toFieldContext(result, via, 'mainPage');
  return { selector: '', context: ctx };
}

/**
 * Probe the main page context for a matching field.
 * @param opts - The resolve options containing page, field, and candidates.
 * @returns A IFieldContext if found, or empty field match.
 */
export async function probeMainPage(opts: IResolveAllOpts): Promise<IFieldContext | IFieldMatch> {
  const { pageOrFrame, bankCandidates, wellKnownCandidates, field } = opts;
  const bankResult = await tryMainGroup({
    ctx: pageOrFrame,
    candidates: bankCandidates,
    credentialKey: field.credentialKey,
    via: 'bankConfig',
  });
  if ('isResolved' in bankResult) return bankResult;
  const wkResult = await tryMainGroup({
    ctx: pageOrFrame,
    candidates: wellKnownCandidates,
    credentialKey: field.credentialKey,
    via: 'wellKnown',
  });
  return wkResult;
}
