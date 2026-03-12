import { type Frame, type Page } from 'playwright';

import { type IFieldConfig, type SelectorCandidate } from '../Scrapers/Base/Config/LoginConfig.js';
import { getDebug } from './Debug.js';
import type { IFieldContext } from './SelectorResolver.js';

const LOG = getDebug('selector-field');

/** Internal match result — callers add isResolved, resolvedVia, round. */
interface IFieldMatch {
  selector: string;
  context: Page | Frame;
  kind?: SelectorCandidate['kind'];
}

/** Internal probe result — selector + which kind matched. */
interface IProbeResult {
  css: string;
  kind: SelectorCandidate['kind'];
}

/** All inputs needed to resolve a single login field. */
export interface IResolveAllOpts {
  pageOrFrame: Page | Frame;
  field: IFieldConfig;
  pageUrl: string;
  bankCandidates: SelectorCandidate[];
  wellKnownCandidates: SelectorCandidate[];
  cachedFrames?: Frame[];
}

/** A function that tries candidates in a context. */
/** Nullable probe result — matches internal API when no candidate matches. */
type NullableProbeResult = Promise<IProbeResult | null>;

/** A function that tries candidates in a context. */
export type TryInContextFn = (
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
) => NullableProbeResult;

/** A function that checks if a Page or Frame is a full Page. */
export type IsPageFn = (pageOrFrame: Page | Frame) => pageOrFrame is Page;

/** Dependencies injected from SelectorResolver. */
export interface IResolverDeps {
  tryInContextInternal: TryInContextFn;
  isPage: IsPageFn;
}

/**
 * Convert a field match to a resolved IFieldContext.
 * @param match - The internal field match result.
 * @param via - Whether resolved via bankConfig or wellKnown.
 * @param round - Whether found in iframe or mainPage.
 * @returns A fully resolved IFieldContext.
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
 * @param pageOrFrame - The Playwright Page or Frame.
 * @returns The page title string.
 */
async function getPageTitle(pageOrFrame: Page | Frame): Promise<string> {
  try {
    return await (pageOrFrame as Page).title();
  } catch {
    return '(unknown)';
  }
}

/** Context for building a 'not found' diagnostic message. */
interface INotFoundContext {
  credentialKey: string;
  pageUrl: string;
  tried: string[];
  pageTitle: string;
}

/**
 * Build a diagnostic message when a field cannot be resolved.
 * @param ctx - The not-found context.
 * @returns A multi-line diagnostic message string.
 */
function buildNotFoundMessage(ctx: INotFoundContext): string {
  const { credentialKey, pageUrl, tried, pageTitle } = ctx;
  return [
    `Could not find '${credentialKey}' field on ${pageUrl}`,
    `Tried ${String(tried.length)} candidates:`,
    ...tried,
    `Page title: "${pageTitle}"`,
    'This usually means the bank redesigned their login page.',
    `Run: npx ts-node scripts/inspect-bank-login.ts --url '${pageUrl}'`,
  ].join('\n');
}

/**
 * Log the tried candidates when field resolution fails.
 * @param key - The credential key that failed.
 * @param url - The page URL where resolution failed.
 * @param tried - The list of formatted candidate strings.
 * @returns True after logging completes.
 */
function logTriedCandidates(key: string, url: string, tried: string[]): boolean {
  LOG.debug('FAILED "%s" on %s (%d tried)', key, url, tried.length);
  for (const line of tried) LOG.debug(line);
  return true;
}

/**
 * Build the tried candidate descriptions for diagnostics.
 * @param opts - The resolve options.
 * @returns An array of formatted description strings.
 */
function buildTriedList(opts: IResolveAllOpts): string[] {
  const { bankCandidates, wellKnownCandidates } = opts;
  return [...bankCandidates, ...wellKnownCandidates].map(
    candidate => `  ${candidate.kind} "${candidate.value}" → NOT found`,
  );
}

/**
 * Build a not-found IFieldContext with diagnostic message.
 * @param opts - The resolve options.
 * @returns An unresolved IFieldContext with diagnostic message.
 */
async function buildNotFoundContext(opts: IResolveAllOpts): Promise<IFieldContext> {
  const { pageOrFrame, field, pageUrl } = opts;
  const tried = buildTriedList(opts);
  logTriedCandidates(field.credentialKey, pageUrl, tried);
  const pageTitle = await getPageTitle(pageOrFrame);
  const notFoundCtx = { credentialKey: field.credentialKey, pageUrl, tried, pageTitle };
  const msg = buildNotFoundMessage(notFoundCtx);
  LOG.debug(msg);
  return buildUnresolvedResult(pageOrFrame, msg);
}

/**
 * Create an unresolved IFieldContext result.
 * @param context - The page or frame context.
 * @param message - The diagnostic message.
 * @returns An unresolved IFieldContext.
 */
function buildUnresolvedResult(context: Page | Frame, message: string): IFieldContext {
  return {
    isResolved: false,
    selector: '',
    context,
    resolvedVia: 'notResolved',
    round: 'notResolved',
    message,
  };
}

/** Options for searching child iframes. */
interface ISearchFramesOpts {
  page: Page;
  allCandidates: SelectorCandidate[];
  deps: IResolverDeps;
  cachedFrames?: Frame[];
}

/**
 * Search child iframes for a matching selector candidate.
 * @param searchOpts - The iframe search options.
 * @returns A field match with selector and context.
 */
async function searchInChildFrames(searchOpts: ISearchFramesOpts): Promise<IFieldMatch> {
  const { page, allCandidates, deps, cachedFrames } = searchOpts;
  const allFrames = cachedFrames ?? page.frames();
  const mainFrame = page.mainFrame();
  const childFrames = allFrames.filter(frame => frame !== mainFrame);
  if (childFrames.length > 0) {
    LOG.debug('Round 1: searching %d iframe(s)', childFrames.length);
  }
  const initial: IFieldMatch = { selector: '', context: page };
  const initialPromise = Promise.resolve(initial);
  return childFrames.reduce(async (accPromise, frame) => {
    const accumulated = await accPromise;
    if (accumulated.selector) return accumulated;
    const found = await deps.tryInContextInternal(frame, allCandidates);
    if (!found) return accumulated;
    const frameUrl = frame.url();
    LOG.debug('Round 1: resolved in iframe %s → %s', frameUrl, found.css);
    return { selector: found.css, context: frame, kind: found.kind };
  }, initialPromise);
}

/** Options for searching the main page context. */
interface IMainContextOpts {
  ctx: Page | Frame;
  allCandidates: SelectorCandidate[];
  credentialKey: string;
  deps: IResolverDeps;
}

/**
 * Search the main page context for a matching selector candidate.
 * @param mainOpts - The main context search options.
 * @returns A field match with selector and context.
 */
async function resolveInMainContext(mainOpts: IMainContextOpts): Promise<IFieldMatch> {
  const { ctx, allCandidates, credentialKey, deps } = mainOpts;
  LOG.debug('Round 2: searching main page');
  const main = await deps.tryInContextInternal(ctx, allCandidates);
  if (!main) return { selector: '', context: ctx };
  LOG.debug('Round 2: resolved "%s" → %s', credentialKey, main.css);
  return { selector: main.css, context: ctx, kind: main.kind };
}

/** Options for iframe and main-page probing. */
interface IProbeOpts {
  opts: IResolveAllOpts;
  deps: IResolverDeps;
}

/** Sentinel for no match — isResolved is false. */
const NOT_FOUND_SENTINEL: IFieldContext = {
  isResolved: false,
  selector: '',
  context: {} as Page,
  resolvedVia: 'notResolved',
  round: 'notResolved',
};

/**
 * Probe child iframes for a field using bank + wellKnown candidates.
 * @param page - The Playwright Page to search iframes of.
 * @param probeOpts - The probe options.
 * @returns A resolved IFieldContext, or a not-found sentinel.
 */
async function probeIframes(page: Page, probeOpts: IProbeOpts): Promise<IFieldContext> {
  const { opts, deps } = probeOpts;
  const { bankCandidates, wellKnownCandidates, cachedFrames } = opts;
  if (bankCandidates.length > 0) {
    const searchOpts = { page, allCandidates: bankCandidates, deps, cachedFrames };
    const result = await searchInChildFrames(searchOpts);
    if (result.selector) return toFieldContext(result, 'bankConfig', 'iframe');
  }
  if (wellKnownCandidates.length > 0) {
    const searchOpts = { page, allCandidates: wellKnownCandidates, deps, cachedFrames };
    const result = await searchInChildFrames(searchOpts);
    if (result.selector) return toFieldContext(result, 'wellKnown', 'iframe');
  }
  return NOT_FOUND_SENTINEL;
}

/**
 * Probe the main page context for a field.
 * @param probeOpts - The probe options.
 * @returns A resolved IFieldContext, or a not-found sentinel.
 */
async function probeMainPage(probeOpts: IProbeOpts): Promise<IFieldContext> {
  const { opts, deps } = probeOpts;
  const { pageOrFrame: ctx, field } = opts;
  const { bankCandidates, wellKnownCandidates } = opts;
  const key = field.credentialKey;
  if (bankCandidates.length > 0) {
    const mainOpts = { ctx, allCandidates: bankCandidates, credentialKey: key, deps };
    const result = await resolveInMainContext(mainOpts);
    if (result.selector) return toFieldContext(result, 'bankConfig', 'mainPage');
  }
  if (wellKnownCandidates.length > 0) {
    const mainOpts = { ctx, allCandidates: wellKnownCandidates, credentialKey: key, deps };
    const result = await resolveInMainContext(mainOpts);
    if (result.selector) return toFieldContext(result, 'wellKnown', 'mainPage');
  }
  return NOT_FOUND_SENTINEL;
}

/**
 * Log the start of a field resolution attempt.
 * @param opts - The resolve options to log.
 * @returns True after logging completes.
 */
function logResolveStart(opts: IResolveAllOpts): boolean {
  const bankCount = String(opts.bankCandidates.length);
  const wkCount = String(opts.wellKnownCandidates.length);
  LOG.debug(
    'resolving "%s": %sb+%swk on %s',
    opts.field.credentialKey,
    bankCount,
    wkCount,
    opts.pageUrl,
  );
  return true;
}

/**
 * Resolve a field by trying iframes first, then main page.
 * @param opts - The full resolve options.
 * @param deps - Injected resolver dependencies.
 * @returns A resolved or not-found IFieldContext.
 */
export async function resolveAll(
  opts: IResolveAllOpts,
  deps: IResolverDeps,
): Promise<IFieldContext> {
  logResolveStart(opts);
  if (deps.isPage(opts.pageOrFrame)) {
    const iframeResult = await probeIframes(opts.pageOrFrame, { opts, deps });
    if (iframeResult.isResolved) return iframeResult;
  }
  const main = await probeMainPage({ opts, deps });
  if (main.isResolved) return main;
  return buildNotFoundContext(opts);
}
