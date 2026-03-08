/* eslint-disable max-lines -- ParsedLoginPage integration adds resolver cache plumbing */
import { type Frame, type Page } from 'playwright';

import { type FieldConfig, type SelectorCandidate } from '../Scrapers/Base/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/ScraperConfig.js';
import { getDebug } from './Debug.js';

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

/** XPath union of elements that can visually label an input field. */
const LABEL_TAGS = 'self::label or self::div or self::span';

/** Convert a SelectorCandidate to a Playwright-compatible selector string */
export function candidateToCss(c: SelectorCandidate): string {
  switch (c.kind) {
    case 'labelText':
      return `xpath=//label[contains(., "${c.value}")]`;
    case 'css':
      return c.value;
    case 'placeholder':
      return `input[placeholder*="${c.value}"]`;
    case 'ariaLabel':
      return `input[aria-label="${c.value}"]`;
    case 'name':
      return `[name="${c.value}"]`;
    case 'xpath':
      return `xpath=${c.value}`;
  }
}

/** True when `pageOrFrame` is a full Page (has `frames()` method). */
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
 * Extract the most likely WELL_KNOWN_SELECTORS key from a CSS selector string.
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

async function queryWithTimeout(ctx: Page | Frame, css: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  const el = await Promise.race([
    ctx.$(css),
    new Promise<null>(resolve => {
      timer = setTimeout(() => {
        resolve(null);
      }, CANDIDATE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer!);
  return el !== null;
}

function debugCandidateSkipped(candidate: SelectorCandidate): void {
  LOG.debug(
    'candidate %s "%s" → skipped (cross-origin / detached frame)',
    candidate.kind,
    candidate.value,
  );
}

async function findInputByForAttr(
  ctx: Page | Frame,
  forAttr: string,
  labelValue: string,
): Promise<string | null> {
  const inputSelector = `#${forAttr}`;
  if (!(await ctx.$(inputSelector))) {
    LOG.debug('labelText "%s" for="%s" but #%s not found', labelValue, forAttr, forAttr);
    return null;
  }
  LOG.debug('resolved labelText "%s" → for="%s" → %s', labelValue, forAttr, inputSelector);
  return inputSelector;
}

/** Check that a resolved element is a fillable input (not hidden/submit/button). */
async function isFillableInput(ctx: Page | Frame, selector: string): Promise<boolean> {
  const tagName = await ctx.$eval(selector, (el: Element) => el.tagName.toLowerCase());
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;
  const type = await ctx.$eval(selector, (el: Element) => el.getAttribute('type') ?? 'text');
  return type !== 'hidden' && type !== 'submit' && type !== 'button';
}

/** Strategy 2: find <input> nested inside the labeling element. */
async function resolveByNestedInput(ctx: Page | Frame, baseXpath: string): Promise<string | null> {
  const xpath = `${baseXpath}//input[1]`;
  if (!(await queryWithTimeout(ctx, xpath))) return null;
  if (!(await isFillableInput(ctx, xpath))) return null;
  LOG.debug('resolved labelText → nested input via %s', baseXpath);
  return xpath;
}

/** Strategy 3: labeling element has id → find input[aria-labelledby="<id>"]. */
async function resolveByAriaRef(
  ctx: Page | Frame,
  label: { getAttribute: (n: string) => Promise<string | null> },
  labelValue: string,
): Promise<string | null> {
  const labelId = await label.getAttribute('id');
  if (!labelId) return null;
  const selector = `input[aria-labelledby="${labelId}"]`;
  if (!(await queryWithTimeout(ctx, selector))) return null;
  LOG.debug('resolved labelText "%s" → aria-labelledby="%s"', labelValue, labelId);
  return selector;
}

/** Strategy 4: labeling element followed by a sibling <input>. */
async function resolveBySibling(ctx: Page | Frame, baseXpath: string): Promise<string | null> {
  const xpath = `${baseXpath}/following-sibling::input[1]`;
  if (!(await queryWithTimeout(ctx, xpath))) return null;
  if (!(await isFillableInput(ctx, xpath))) return null;
  LOG.debug('resolved labelText → sibling input via %s', baseXpath);
  return xpath;
}

/** Strategy 5: nearest <input> in the same parent container. */
async function resolveByProximity(ctx: Page | Frame, baseXpath: string): Promise<string | null> {
  const xpath = `${baseXpath}/..//input[1]`;
  if (!(await queryWithTimeout(ctx, xpath))) return null;
  if (!(await isFillableInput(ctx, xpath))) return null;
  LOG.debug('resolved labelText → proximity input via %s', baseXpath);
  return xpath;
}

/** Inputs for label-based input resolution strategies. */
interface LabelStrategyOpts {
  ctx: Page | Frame;
  label: { getAttribute: (n: string) => Promise<string | null> };
  baseXpath: string;
  labelValue: string;
}

/** Try label-based resolution (for-attr, then nesting/ariaRef/sibling/proximity). */
async function resolveLabelStrategies(opts: LabelStrategyOpts): Promise<string | null> {
  const { ctx, label, baseXpath, labelValue } = opts;
  const forAttr = await label.getAttribute('for');
  if (forAttr) return findInputByForAttr(ctx, forAttr, labelValue);
  return (
    (await resolveByNestedInput(ctx, baseXpath)) ??
    (await resolveByAriaRef(ctx, label, labelValue)) ??
    (await resolveBySibling(ctx, baseXpath)) ??
    (await resolveByProximity(ctx, baseXpath))
  );
}

/**
 * Strict XPath for div/span: matches only elements whose OWN text
 * (not nested children) contains the value. Prevents matching large containers.
 */
function divSpanStrictXpath(value: string): string {
  return `xpath=//*[${LABEL_TAGS}][text()[contains(., "${value}")]]`;
}

/** Resolve a labelText candidate: <label> first, then div/span with strict text. */
async function resolveLabelText(
  ctx: Page | Frame,
  labelXpath: string,
  labelValue: string,
): Promise<string | null> {
  const label = await ctx.$(labelXpath);
  if (label) return resolveLabelStrategies({ ctx, label, baseXpath: labelXpath, labelValue });
  const strictXpath = divSpanStrictXpath(labelValue);
  const divSpan = await ctx.$(strictXpath);
  if (!divSpan) return null;
  LOG.debug('labelText "%s" found via div/span fallback', labelValue);
  return resolveLabelStrategies({ ctx, label: divSpan, baseXpath: strictXpath, labelValue });
}

async function probeLabelText(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<ProbeResult | null> {
  const css = candidateToCss(candidate);
  const resolved = await resolveLabelText(ctx, css, candidate.value);
  return resolved ? { css: resolved, kind: 'labelText' } : null;
}

async function probeCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<ProbeResult | null> {
  try {
    if (candidate.kind === 'labelText') return await probeLabelText(ctx, candidate);
    const css = candidateToCss(candidate);
    const isFound = await queryWithTimeout(ctx, css);
    if (isFound) {
      LOG.debug('resolved %s "%s" → %s', candidate.kind, candidate.value, css);
      return { css, kind: candidate.kind };
    }
    LOG.debug('candidate %s "%s" → NOT FOUND', candidate.kind, candidate.value);
  } catch {
    debugCandidateSkipped(candidate);
  }
  return null;
}

/** Internal: try each candidate, return first match with kind metadata. */
async function tryInContextInternal(
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
): Promise<ProbeResult | null> {
  for (const candidate of candidates) {
    const found = await probeCandidate(ctx, candidate);
    if (found) return found;
  }
  return null;
}

/**
 * Try each candidate on `ctx` with a per-candidate timeout.
 * Returns the first CSS string that resolves within CANDIDATE_TIMEOUT_MS, or null.
 */
export async function tryInContext(
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
): Promise<string | null> {
  const result = await tryInContextInternal(ctx, candidates);
  return result?.css ?? null;
}

/**
 * The resolved location of a login field — always returned, never throws.
 * Check `isResolved` before using `selector` / `context`.
 * - `resolvedVia`: 'bankConfig' (bank's own selector) | 'wellKnown' (global fallback) | 'notResolved'
 * - `round`: 'iframe' (found in child frame) | 'mainPage' (found in main context) | 'notResolved'
 */
export interface FieldContext {
  isResolved: boolean;
  selector: string;
  context: Page | Frame;
  resolvedVia: 'bankConfig' | 'wellKnown' | 'notResolved';
  round: 'iframe' | 'mainPage' | 'notResolved';
  /** Which SelectorCandidate kind actually matched (additive, optional). */
  resolvedKind?: SelectorCandidate['kind'];
  /** Diagnostic message — populated when isResolved is false */
  message?: string;
}

/** Internal match result — callers add isResolved, resolvedVia, round.
 *  `selector` is empty string when not found (never null). */
interface FieldMatch {
  selector: string;
  context: Page | Frame;
  kind?: SelectorCandidate['kind'];
}

/** Internal probe result — selector + which kind matched. */
interface ProbeResult {
  css: string;
  kind: SelectorCandidate['kind'];
}

async function searchInChildFrames(
  page: Page,
  allCandidates: SelectorCandidate[],
  cachedFrames?: Frame[],
): Promise<FieldMatch> {
  const childFrames = cachedFrames ?? page.frames().filter(f => f !== page.mainFrame());
  if (childFrames.length > 0) LOG.debug('Round 1: searching %d iframe(s)', childFrames.length);
  for (const frame of childFrames) {
    const found = await tryInContextInternal(frame, allCandidates);
    if (found) {
      LOG.debug('Round 1: resolved in iframe %s → %s', frame.url(), found.css);
      return { selector: found.css, context: frame, kind: found.kind };
    }
  }
  return { selector: '', context: page }; // not found — caller checks selector !== ''
}

async function getPageTitle(pageOrFrame: Page | Frame): Promise<string> {
  try {
    return await (pageOrFrame as Page).title();
  } catch {
    return '(unknown)';
  }
}

/**
 * Resolve a FieldConfig to a selector + context pair.
 */
interface NotFoundContext {
  credentialKey: string;
  pageUrl: string;
  tried: string[];
  pageTitle: string;
}

function buildNotFoundMessage(ctx: NotFoundContext): string {
  const { credentialKey, pageUrl, tried, pageTitle } = ctx;
  return (
    `Could not find '${credentialKey}' field on ${pageUrl}\n` +
    `Tried ${tried.length} candidates:\n` +
    tried.join('\n') +
    `\nPage title: "${pageTitle}"\n` +
    'This usually means the bank redesigned their login page.\n' +
    `Run: npx ts-node scripts/inspect-bank-login.ts --url '${pageUrl}' to re-detect selectors.`
  );
}

async function resolveInMainContext(
  pageOrFrame: Page | Frame,
  allCandidates: SelectorCandidate[],
  credentialKey: string,
): Promise<FieldMatch> {
  LOG.debug('Round 2: searching main page');
  const main = await tryInContextInternal(pageOrFrame, allCandidates);
  if (!main) return { selector: '', context: pageOrFrame }; // not found
  LOG.debug('Round 2: resolved "%s" → %s', credentialKey, main.css);
  return { selector: main.css, context: pageOrFrame, kind: main.kind };
}

/** All inputs needed to resolve a single login field. */
interface ResolveAllOpts {
  pageOrFrame: Page | Frame;
  field: FieldConfig;
  pageUrl: string;
  bankCandidates: SelectorCandidate[];
  wellKnownCandidates: SelectorCandidate[];
  /** Pre-cached child frames from stepParseLoginPage — skips page.frames() call. */
  cachedFrames?: Frame[];
}

function logTriedCandidates(key: string, url: string, tried: string[]): void {
  LOG.debug('FAILED "%s" on %s (%d tried)', key, url, tried.length);
  for (const line of tried) LOG.debug(line);
}

async function buildNotFoundContext(opts: ResolveAllOpts): Promise<FieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  const tried = [...b, ...wk].map(c => `  ${c.kind} "${c.value}" → NOT found`);
  logTriedCandidates(field.credentialKey, pageUrl, tried);
  const msg = buildNotFoundMessage({
    credentialKey: field.credentialKey,
    pageUrl,
    tried,
    pageTitle: await getPageTitle(pageOrFrame),
  });
  LOG.debug(msg);
  return {
    isResolved: false,
    selector: '',
    context: pageOrFrame,
    resolvedVia: 'notResolved',
    round: 'notResolved',
    message: msg,
  };
}

function toFieldContext(
  match: FieldMatch,
  via: FieldContext['resolvedVia'],
  round: FieldContext['round'],
): FieldContext {
  return {
    isResolved: true,
    selector: match.selector,
    context: match.context,
    resolvedVia: via,
    round,
    resolvedKind: match.kind,
  };
}

async function probeIframes(page: Page, opts: ResolveAllOpts): Promise<FieldContext | null> {
  const { bankCandidates: b, wellKnownCandidates: wk, cachedFrames } = opts;
  if (b.length > 0) {
    const r = await searchInChildFrames(page, b, cachedFrames);
    if (r.selector) return toFieldContext(r, 'bankConfig', 'iframe');
  }
  if (wk.length > 0) {
    const r = await searchInChildFrames(page, wk, cachedFrames);
    if (r.selector) return toFieldContext(r, 'wellKnown', 'iframe');
  }
  return null;
}

async function probeMainPage(opts: ResolveAllOpts): Promise<FieldContext | null> {
  const { pageOrFrame: ctx, bankCandidates: b, wellKnownCandidates: wk, field } = opts;
  if (b.length > 0) {
    const r = await resolveInMainContext(ctx, b, field.credentialKey);
    if (r.selector) return toFieldContext(r, 'bankConfig', 'mainPage');
  }
  if (wk.length > 0) {
    const r = await resolveInMainContext(ctx, wk, field.credentialKey);
    if (r.selector) return toFieldContext(r, 'wellKnown', 'mainPage');
  }
  return null;
}

async function resolveAll(opts: ResolveAllOpts): Promise<FieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  LOG.debug(`resolving "${field.credentialKey}": ${b.length}b+${wk.length}wk on ${pageUrl}`);
  if (isPage(pageOrFrame)) {
    const r = await probeIframes(pageOrFrame, opts);
    if (r) return r;
  }
  const main = await probeMainPage(opts);
  if (main) return main;
  return buildNotFoundContext(opts);
}

export async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: FieldConfig,
  pageUrl: string,
): Promise<FieldContext> {
  return resolveAll({
    pageOrFrame,
    field,
    pageUrl,
    bankCandidates: [...field.selectors],
    wellKnownCandidates: [...(WELL_KNOWN_SELECTORS[field.credentialKey] ?? [])],
  });
}

/** Options for resolving with pre-cached frames from stepParseLoginPage. */
export interface CachedResolveOpts {
  pageOrFrame: Page | Frame;
  field: FieldConfig;
  pageUrl: string;
  cachedFrames: Frame[];
}

/** Resolve with pre-cached frames from stepParseLoginPage. */
export async function resolveFieldWithCache(opts: CachedResolveOpts): Promise<FieldContext> {
  return resolveAll({
    ...opts,
    bankCandidates: [...opts.field.selectors],
    wellKnownCandidates: [...(WELL_KNOWN_SELECTORS[opts.field.credentialKey] ?? [])],
  });
}

/**
 * Extract the first CSS string from a SelectorCandidate array.
 * Use this as a backward-compatibility adapter for scrapers not yet migrated
 * to full resolveDashboardField() resolution.
 */
export function toFirstCss(candidates: SelectorCandidate[]): string {
  return candidates.length > 0 ? candidateToCss(candidates[0]) : '';
}

/** Options for resolving a post-login dashboard selector. */
export interface DashboardFieldOpts {
  pageOrFrame: Page | Frame;
  fieldKey: string;
  bankCandidates: SelectorCandidate[];
  pageUrl: string;
}

/**
 * Resolve a dashboard data field using the same round-trip as login resolution:
 * iframes first (if Page), then main context; bank candidates first, wellKnown fallback second.
 * Returns a FieldContext — check `isResolved` before using `selector` / `context`.
 */
export async function resolveDashboardField(opts: DashboardFieldOpts): Promise<FieldContext> {
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
