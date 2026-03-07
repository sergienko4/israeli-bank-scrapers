import { type Frame, type Page } from 'playwright';

import type { IDashboardFieldOpts } from '../Interfaces/Common/DashboardFieldOpts';
import type { IFieldContext } from '../Interfaces/Common/FieldContext';
import type { FoundResult } from '../Interfaces/Common/FoundResult';
import type { IResolveAllOpts } from '../Interfaces/Common/ResolveAllOpts';
import type { IDoneResult } from '../Interfaces/Common/StepResult';
import { type IFieldConfig, type SelectorCandidate } from '../Scrapers/Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/ScraperConfig';
import { getDebug } from './Debug';

export type { IDashboardFieldOpts } from '../Interfaces/Common/DashboardFieldOpts';
export type { IFieldContext } from '../Interfaces/Common/FieldContext';

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
 * Converts a SelectorCandidate descriptor to a Playwright-compatible CSS or xpath selector string.
 * Label candidates return an empty string because they are resolved separately via probeLabelCandidate.
 *
 * @param c - the SelectorCandidate to convert
 * @returns a Playwright selector string, or an empty string for label candidates
 */
export function candidateToCss(c: SelectorCandidate): string {
  switch (c.kind) {
    case 'css':
      return c.value;
    case 'placeholder':
      return `input[placeholder*="${c.value}"]`;
    case 'ariaLabel':
      return `[aria-label*="${c.value}"]`;
    case 'name':
      return `[name="${c.value}"]`;
    case 'xpath':
      return `xpath=${c.value}`;
    case 'label':
      return ''; // handled by probeLabelCandidate — never reaches this path
  }
}

/**
 * Type guard that returns true when the argument is a full Playwright Page rather than a Frame.
 * Distinguishes the two by checking for the presence of a `frames()` method.
 *
 * @param pageOrFrame - the value to test
 * @returns true when pageOrFrame is a Page, narrowing the type accordingly
 */
function isPage(pageOrFrame: Page | Frame): pageOrFrame is Page {
  return 'frames' in pageOrFrame && typeof (pageOrFrame as unknown as Page).frames === 'function';
}

/** Max ms to wait for a single `$()` call before treating it as not found. */
const CANDIDATE_TIMEOUT_MS = 2000;

const CREDENTIAL_KEY_MAP: Record<string, string> = {
  password: 'password',
  sisma: 'password',
  tzpassword: 'password',
  usercode: 'username',
  username: 'username',
  usernum: 'username',
  uid: 'id',
  tzid: 'id',
  aidnum: 'num',
  num: 'num',
  account: 'num',
};

/**
 * Extracts the most likely WELL_KNOWN_SELECTORS key from a CSS selector string.
 * Normalises common bank-specific ID names (e.g. `#tzId`, `#aidnum`) to canonical keys
 * like 'id', 'password', or 'username' that map to well-known fallback selectors.
 *
 * @param selector - a CSS selector string, typically starting with '#' for an element ID
 * @returns a canonical credential key such as 'username', 'password', 'id', or 'num'
 */
export function extractCredentialKey(selector: string): string {
  const id = /^#([a-zA-Z0-9_-]+)/.exec(selector)?.[1] ?? selector;
  const lower = id.toLowerCase();
  const directMatch = CREDENTIAL_KEY_MAP[lower];
  if (directMatch) return directMatch;
  for (const [key, val] of Object.entries(CREDENTIAL_KEY_MAP)) {
    if (lower.includes(key)) return val;
  }
  if (lower.startsWith('id') && lower.length <= 4) return 'id';
  return id;
}

/**
 * Queries a Page or Frame for a CSS selector with a hard per-candidate timeout.
 * Returns false when the timeout expires rather than waiting for Playwright's default.
 *
 * @param ctx - the Playwright Page or Frame to query
 * @param css - the CSS selector to search for
 * @returns true when the element is found within CANDIDATE_TIMEOUT_MS, false otherwise
 */
async function queryWithTimeout(ctx: Page | Frame, css: string): Promise<boolean> {
  const el = await Promise.race([
    ctx.$(css),
    new Promise<null>(resolve =>
      setTimeout(() => {
        resolve(null);
      }, CANDIDATE_TIMEOUT_MS),
    ),
  ]);
  return el !== null;
}

/**
 * Logs a diagnostic message indicating that a selector candidate was skipped due to a
 * cross-origin or detached frame context error during resolution.
 *
 * @param candidate - the SelectorCandidate that could not be evaluated
 * @returns a done result indicating the log entry was written
 */
function debugCandidateSkipped(candidate: SelectorCandidate): IDoneResult {
  LOG.info(
    'candidate %s "%s" → skipped (cross-origin / detached frame)',
    candidate.kind,
    candidate.value,
  );
  return { done: true };
}

/**
 * Browser-side function that scans every label element for one containing the given text,
 * then resolves a CSS selector for the associated input, textarea, or select element.
 * This function is serialised and executed inside the browser context via page.evaluate().
 *
 * @param text - the label text content to search for
 * @returns a CSS selector string for the associated form control, or empty string when not found
 */
function scanLabelForInput(text: string): string {
  const allLabels = document.querySelectorAll('label');
  const m = Array.from(allLabels).find(l => l.textContent.includes(text));
  if (!m) return '';
  const fid = m.getAttribute('for');
  if (fid && document.getElementById(fid)) return `#${fid}`;
  const ch = m.querySelector('input, textarea, select');
  if (!(ch instanceof HTMLElement)) return '';
  if (ch.id) return `#${ch.id}`;
  const n = ch.getAttribute('name');
  return n ? `[name="${n}"]` : '';
}

/**
 * Last-resort resolver that finds a form input by the visible text of its associated label.
 * Executes scanLabelForInput inside the browser context and logs the outcome.
 *
 * @param ctx - the Playwright Page or Frame to evaluate in
 * @param labelText - the visible label text to search for
 * @returns a CSS selector for the labelled input, or empty string when not found or on context error
 */
async function probeLabelCandidate(ctx: Page | Frame, labelText: string): Promise<string> {
  try {
    const result = await ctx.evaluate(scanLabelForInput, labelText);
    if (result) LOG.info('resolved label "%s" → %s', labelText, result);
    else LOG.info('candidate label "%s" → NOT FOUND', labelText);
    return result;
  } catch {
    debugCandidateSkipped({ kind: 'label', value: labelText });
    return '';
  }
}

/**
 * Tests a single SelectorCandidate against the given Page or Frame context.
 * Delegates to probeLabelCandidate for label kind; uses queryWithTimeout for all others.
 *
 * @param ctx - the Playwright Page or Frame to test the candidate in
 * @param candidate - the SelectorCandidate descriptor to probe
 * @returns the resolved CSS selector string when found, or empty string when not found or on error
 */
async function probeCandidate(ctx: Page | Frame, candidate: SelectorCandidate): Promise<string> {
  if (candidate.kind === 'label') return probeLabelCandidate(ctx, candidate.value);
  const css = candidateToCss(candidate);
  try {
    const isFound = await queryWithTimeout(ctx, css);
    if (isFound) {
      LOG.info('resolved %s "%s" → %s', candidate.kind, candidate.value, css);
      return css;
    }
    LOG.info('candidate %s "%s" → NOT FOUND', candidate.kind, candidate.value);
  } catch {
    debugCandidateSkipped(candidate);
  }
  return '';
}

/**
 * Tries each SelectorCandidate on the given context sequentially with a per-candidate timeout.
 * Returns the first resolved CSS string, or undefined when no candidate matches.
 *
 * @param ctx - the Playwright Page or Frame to search in
 * @param candidates - an ordered list of SelectorCandidates to probe in sequence
 * @returns the first CSS selector that resolves within CANDIDATE_TIMEOUT_MS, or empty string
 */
export async function tryInContext(
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
): Promise<string> {
  const initial = Promise.resolve('');
  return candidates.reduce(
    async (acc, candidate) => (await acc) || probeCandidate(ctx, candidate),
    initial,
  );
}

/**
 * Searches all child frames of the given page for the first candidate that resolves.
 * Returns the resolved selector and frame context, or an empty selector when nothing is found.
 *
 * @param page - the Playwright Page whose child frames are searched
 * @param allCandidates - the SelectorCandidates to probe in each child frame
 * @returns an object with the resolved selector string and the frame context; selector is '' when not found
 */
async function searchInChildFrames(
  page: Page,
  allCandidates: SelectorCandidate[],
): Promise<{ selector: string; context: Page | Frame }> {
  const childFrames = page.frames().filter(f => f !== page.mainFrame());
  if (childFrames.length > 0) LOG.info('Round 1: searching %d iframe(s)', childFrames.length);
  const frameProbes = childFrames.map(async frame => ({
    frame,
    found: await tryInContext(frame, allCandidates),
  }));
  const frameResults = await Promise.all(frameProbes);
  const match = frameResults.find(r => r.found !== '');
  if (match?.found) {
    const matchedFrameUrl = match.frame.url();
    LOG.info('Round 1: resolved in iframe %s → %s', matchedFrameUrl, match.found);
    return { selector: match.found, context: match.frame };
  }
  return { selector: '', context: page }; // not found — caller checks selector !== ''
}

/**
 * Returns the page title for diagnostic messages without throwing on context errors.
 *
 * @param pof - the Playwright Page or Frame to retrieve the title from
 * @returns the page title string, or '(unknown)' when the title cannot be retrieved
 */
async function getPageTitle(pof: Page | Frame): Promise<string> {
  try {
    return await (pof as Page).title();
  } catch {
    return '(unknown)';
  }
}

/**
 * Constructs a human-readable error message for when a login field cannot be resolved.
 * Includes the credential key, URL, list of tried candidates, and page title.
 *
 * @param ctx - context with the credential key, page URL, tried candidates, and page title
 * @param ctx.credentialKey - the name of the credential field that could not be found
 * @param ctx.pageUrl - the URL of the page where resolution was attempted
 * @param ctx.tried - a list of human-readable strings describing each candidate that was tried
 * @param ctx.pageTitle - the page title at the time of the failed resolution
 * @returns a multi-line diagnostic string describing the resolution failure
 */
function buildNotFoundMessage(ctx: {
  credentialKey: string;
  pageUrl: string;
  tried: string[];
  pageTitle: string;
}): string {
  const { credentialKey, pageUrl, tried, pageTitle } = ctx;
  return [
    `Could not find '${credentialKey}' field on ${pageUrl}`,
    `Tried ${String(tried.length)} candidates:`,
    ...tried,
    `Page title: "${pageTitle}"`,
    'This usually means the bank redesigned their login page.',
    `Run: npx ts-node scripts/inspect-bank-login.ts --url '${pageUrl}' to re-detect selectors.`,
  ].join('\n');
}

/**
 * Attempts to resolve a field selector on the main page context (not iframes).
 * Returns an object with an empty selector string when none of the candidates match.
 *
 * @param pageOrFrame - the main Playwright Page or Frame to search
 * @param allCandidates - the SelectorCandidates to probe in sequence
 * @param credentialKey - the field name used in diagnostic log messages
 * @returns an object with the resolved selector and the same context; selector is '' when not found
 */
async function resolveInMainContext(
  pageOrFrame: Page | Frame,
  allCandidates: SelectorCandidate[],
  credentialKey: string,
): Promise<{ selector: string; context: Page | Frame }> {
  LOG.info('Round 2: searching main page');
  const main = await tryInContext(pageOrFrame, allCandidates);
  if (!main) return { selector: '', context: pageOrFrame }; // not found
  LOG.info('Round 2: resolved "%s" → %s', credentialKey, main);
  return { selector: main, context: pageOrFrame };
}

/**
 * Builds a IFieldContext representing a failed resolution, logging all tried candidates and
 * constructing a diagnostic message with page title and URL for error reporting.
 *
 * @param opts - the full resolution options including page, field config, URL, and candidates
 * @returns a IFieldContext with isResolved=false and a diagnostic message
 */
async function buildNotFoundContext(opts: IResolveAllOpts): Promise<IFieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  const tried = [...b, ...wk].map(c => `  ${c.kind} "${c.value}" → NOT found`);
  LOG.info('FAILED "%s" on %s (%d tried)', field.credentialKey, pageUrl, tried.length);
  for (const t of tried) LOG.info(t);
  const msg = buildNotFoundMessage({
    credentialKey: field.credentialKey,
    pageUrl,
    tried,
    pageTitle: await getPageTitle(pageOrFrame),
  });
  return {
    isResolved: false,
    selector: '',
    context: pageOrFrame,
    resolvedVia: 'notResolved',
    round: 'notResolved',
    message: msg,
  };
}

/**
 * Probes child iframes with a single candidate set and returns the first match as FoundResult.
 *
 * @param page - the Playwright Page whose child frames should be searched
 * @param candidates - SelectorCandidates to probe in each iframe
 * @param resolvedVia - whether these are bank-config or well-known candidates
 * @returns a FoundResult wrapping a resolved IFieldContext, or isFound: false
 */
async function probeFrames(
  page: Page,
  candidates: SelectorCandidate[],
  resolvedVia: 'bankConfig' | 'wellKnown',
): Promise<FoundResult<IFieldContext>> {
  if (candidates.length === 0) return { isFound: false };
  const r = await searchInChildFrames(page, candidates);
  if (!r.selector) return { isFound: false };
  return { isFound: true, value: { isResolved: true, ...r, resolvedVia, round: 'iframe' } };
}

/**
 * Probes child iframes for the field, first with bank-specific candidates then well-known ones.
 * Returns a FoundResult wrapping the resolved IFieldContext, or isFound: false when no iframe matches.
 *
 * @param page - the Playwright Page whose child frames should be searched
 * @param b - bank-specific SelectorCandidates to try first
 * @param wk - well-known fallback SelectorCandidates to try when bank candidates fail
 * @returns a FoundResult wrapping a resolved IFieldContext, or isFound: false
 */
async function probeIframes(
  page: Page,
  b: SelectorCandidate[],
  wk: SelectorCandidate[],
): Promise<FoundResult<IFieldContext>> {
  const bankResult = await probeFrames(page, b, 'bankConfig');
  if (bankResult.isFound) return bankResult;
  return probeFrames(page, wk, 'wellKnown');
}

/**
 * Probes the main page context for the field, first with bank-specific candidates then well-known ones.
 * Returns a FoundResult wrapping the resolved IFieldContext, or isFound: false when nothing matched.
 *
 * @param opts - resolution options including page context, field config, URL, and both candidate sets
 * @returns a FoundResult wrapping a resolved IFieldContext, or isFound: false
 */
async function probeMainPage(opts: IResolveAllOpts): Promise<FoundResult<IFieldContext>> {
  const { pageOrFrame: ctx, bankCandidates: b, wellKnownCandidates: wk, field } = opts;
  if (b.length > 0) {
    const r = await resolveInMainContext(ctx, b, field.credentialKey);
    if (r.selector)
      return {
        isFound: true,
        value: { isResolved: true, ...r, resolvedVia: 'bankConfig', round: 'mainPage' },
      };
  }
  if (wk.length > 0) {
    const r = await resolveInMainContext(ctx, wk, field.credentialKey);
    if (r.selector)
      return {
        isFound: true,
        value: { isResolved: true, ...r, resolvedVia: 'wellKnown', round: 'mainPage' },
      };
  }
  return { isFound: false };
}

/**
 * Full two-round field resolution: main page first (Round 1), iframes fallback (Round 2).
 * Bank-specific candidates are tried before well-known fallbacks in each round.
 * Returns a IFieldContext with isResolved=false and a diagnostic message when nothing is found.
 *
 * @param opts - resolution options including page context, field config, URL, and candidate sets
 * @returns a IFieldContext describing where the field was found, or a not-found context
 */
async function resolveAll(opts: IResolveAllOpts): Promise<IFieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  const bLen = String(b.length);
  const wkLen = String(wk.length);
  LOG.info(`resolving "${field.credentialKey}": ${bLen}b+${wkLen}wk on ${pageUrl}`);
  const main = await probeMainPage(opts); // main page first — avoids iframe false positives
  if (main.isFound) return main.value;
  if (isPage(pageOrFrame)) {
    const r = await probeIframes(pageOrFrame, b, wk); // iframes fallback
    if (r.isFound) return r.value;
  }
  return buildNotFoundContext(opts);
}

/**
 * Resolves a login field to a selector and context using bank-specific and well-known candidates.
 * Merges the field's selectors with any global well-known selectors for the credential key,
 * then delegates to resolveAll for the two-round main-page + iframe search.
 *
 * @param pageOrFrame - the Playwright Page or Frame on which to resolve the field
 * @param field - the IFieldConfig describing the credential key and ordered selector candidates
 * @param pageUrl - the current page URL, used for logging and error messages
 * @returns a IFieldContext with the resolved selector and context, or a not-found context
 */
export async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: IFieldConfig,
  pageUrl: string,
): Promise<IFieldContext> {
  const bank = [...field.selectors];
  const wellKnown = [...(WELL_KNOWN_SELECTORS[field.credentialKey] ?? [])];
  return resolveAll({
    pageOrFrame,
    field,
    pageUrl,
    bankCandidates: bank,
    wellKnownCandidates: wellKnown,
  });
}

/**
 * Convenience wrapper: resolve a field and return only the CSS selector string.
 *
 * @deprecated Prefer resolveFieldContext when the caller needs to know which frame the element lives in.
 * @param pageOrFrame - the Playwright Page or Frame to resolve the field on
 * @param field - the IFieldConfig describing the credential key and selector candidates
 * @param pageUrl - the current page URL for logging and error messages
 * @returns the resolved CSS selector string, or an empty string when not found
 */
export async function resolveSelector(
  pageOrFrame: Page | Frame,
  field: IFieldConfig,
  pageUrl: string,
): Promise<string> {
  const { selector } = await resolveFieldContext(pageOrFrame, field, pageUrl);
  return selector;
}

/**
 * Extracts the first CSS string from a SelectorCandidate array.
 * Use this as a backward-compatibility adapter for scrapers not yet migrated
 * to full resolveDashboardField() resolution.
 *
 * @param candidates - the array of SelectorCandidates to extract from
 * @returns the CSS selector string for the first candidate, or an empty string for empty arrays
 */
export function toFirstCss(candidates: SelectorCandidate[]): string {
  return candidates.length > 0 ? candidateToCss(candidates[0]) : '';
}

/**
 * Resolves a dashboard data field using the same two-round strategy as login resolution:
 * main page first, then iframes; bank candidates before well-known fallbacks.
 * Returns a IFieldContext — check `isResolved` before using `selector` and `context`.
 *
 * @param opts - options including the page or frame, field key, bank candidates, and page URL
 * @returns a IFieldContext describing where the field was found, or a not-found context
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
