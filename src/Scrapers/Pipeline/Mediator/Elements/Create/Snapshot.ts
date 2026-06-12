/**
 * Post-race element snapshotting — capture the resolved element's
 * value, DOM identity, and a bounded outerHTML snippet so the rest of
 * the pipeline can build precise ACTION-stage selectors without
 * re-deriving them from the original WK candidate.
 *
 * Public surface:
 *   - `snapshotValue` — read the winning element's text or href before
 *     the next click invalidates it (stale-element protection).
 *   - `extractAndTraceIdentity` — capture tag/id/classes/attrs +
 *     outerHTML and emit the debug trace; returns the identity bundle.
 *   - `buildFoundResult` — package winner data into the `IRaceResult`
 *     contract consumed by every resolve* helper.
 *   - `formatLocatorDetail` — render a single fulfilled-index line for
 *     the race diagnostic trace (kind:value @ url).
 *   - `IWinnerInfo` — the {index,value,identity} bundle passed to
 *     `buildFoundResult` so callers stay under the 3-param ceiling.
 *
 * All other helpers (browser-side evaluate callbacks, partial-payload
 * normalisation, log shaping) stay private — they have no callers
 * outside this cluster.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §5).
 */

import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { type IElementIdentity, type IRaceResult } from '../ElementMediator.js';
import type { ILocatorEntry } from './Entries.js';

const LOG = getDebug(import.meta.url);

/**
 * Walk up DOM from element to nearest `<a>` ancestor and return its href.
 * Structural CSS for extraction — allowed per CLAUDE.md exceptions.
 * Uses `closest('a')` for flat, null-safe ancestor traversal.
 *
 * <p>Returns the RAW `href` attribute (not `.href` which resolves via
 * `document.baseURI`) so this fallback branch matches the direct-branch
 * snapshot in {@link resolveHrefSnapshot} byte-for-byte. Without this,
 * downstream selector building behaves differently depending on which
 * branch ran — the direct-branch returns `/account/123` while the
 * ancestor-walk used to return `https://bank.example/account/123`.
 *
 * @param el - Starting DOM element.
 * @returns Raw href attribute from the nearest anchor ancestor, or empty string.
 */
function walkUpToAnchorHref(el: Element): string {
  const anchor = el.closest('a');
  if (anchor) return anchor.getAttribute('href') ?? '';
  return '';
}

/** Sentinel for absent attribute values. */
const NO_ATTR = '(none)';

/**
 * Extract diagnostic trace info from a DOM element.
 * Inlined ternaries to fit under the 10-LoC cap.
 * @param el - The DOM element.
 * @returns Diagnostic string with tag, text, href, aria.
 */
function traceElementInfo(el: Element): string {
  const rawText = el.textContent;
  const text = rawText ? rawText.slice(0, 30).trim() : NO_ATTR;
  const href = el.getAttribute('href') ?? NO_ATTR;
  const aria = el.getAttribute('aria-label') ?? NO_ATTR;
  const closestA = el.closest('a');
  const aHref = closestA ? (closestA.getAttribute('href') ?? NO_ATTR) : 'NO_ANCHOR';
  return `tag=${el.tagName} text=${text} href=${href} aria=${aria} closestA=${aHref}`;
}

/**
 * Emit the snapshotValue debug trace.
 * @param elInfo - Result of traceElementInfo (or 'error').
 * @param candidateInfo - Candidate kind=value descriptor.
 * @returns True after logging.
 */
function traceSnapshot(elInfo: string, candidateInfo: string): true {
  const elMasked = maskVisibleText(elInfo);
  const candMasked = maskVisibleText(candidateInfo);
  LOG.debug({ message: `snapshotValue: [${elMasked}] candidate=${candMasked}` });
  return true;
}

/**
 * Resolve href snapshot: try directly, then walk up to nearest ancestor anchor.
 * @param entry - The winning locator entry.
 * @returns Resolved href or empty string.
 */
async function resolveHrefSnapshot(entry: ILocatorEntry): Promise<string> {
  const directHref = await entry.locator.getAttribute('href').catch((): string => '');
  if (directHref) return directHref;
  return entry.locator.evaluate(walkUpToAnchorHref).catch((): string => '');
}

/**
 * Snapshot the element value immediately to prevent stale-element errors.
 * For target:'href' candidates, captures href + walks up to nearest `<a>` ancestor.
 * Otherwise captures innerText.
 * @param entry - The winning locator entry.
 * @returns The captured text or href value.
 */
export async function snapshotValue(entry: ILocatorEntry): Promise<string> {
  const target = entry.candidate.target ?? 'self';
  if (target !== 'href') return entry.locator.innerText().catch((): string => '');
  const elInfo = await entry.locator.evaluate(traceElementInfo).catch((): string => 'error');
  traceSnapshot(elInfo, `${entry.candidate.kind}="${entry.candidate.value}"`);
  return resolveHrefSnapshot(entry);
}

/** Post-race winner details bundled to satisfy the 3-param ceiling. */
export interface IWinnerInfo {
  readonly index: number;
  readonly value: string;
  readonly identity: IElementIdentity;
}

/**
 * Build a successful IRaceResult from a winning entry.
 * @param entry - The winning locator entry.
 * @param winner - Winner index + snapshot value + DOM identity captured at
 *   resolve time (used by ACTION to build a precise click selector).
 * @returns A found IRaceResult.
 */
export function buildFoundResult(entry: ILocatorEntry, winner: IWinnerInfo): IRaceResult {
  const { locator, candidate, context } = entry;
  const { index, value, identity } = winner;
  return { found: true, locator, candidate, context, index, value, identity };
}

/** Identity for "?" — used when evaluate() throws. */
const UNKNOWN_IDENTITY: IElementIdentity = {
  tag: '?',
  id: '?',
  classes: '?',
  name: '?',
  type: '?',
  ariaLabel: '?',
  title: '?',
  href: '?',
};

/** Max chars of outerHTML to surface in trace logs (forensic snippet). */
const OUTER_HTML_SNIPPET_MAX = 300;

/** Identity bundled with a bounded outerHTML snippet — single-evaluate result. */
interface IIdentityVerbose {
  readonly identity: IElementIdentity;
  readonly outerHtml: string;
}

/** Fallback verbose payload — used when evaluate throws. */
const UNKNOWN_VERBOSE: IIdentityVerbose = { identity: UNKNOWN_IDENTITY, outerHtml: '?' };

/**
 * Resolve `obj.outerHtml` to a string when present, falling back to `?`
 * when the field is missing or non-string (test mocks may return non-string
 * payloads).
 * @param obj - Partial verbose payload.
 * @returns A guaranteed outerHTML snippet.
 */
function resolveOuterHtml(obj: Partial<IIdentityVerbose>): string {
  if (typeof obj.outerHtml === 'string') return obj.outerHtml;
  return '?';
}

/**
 * Normalize a partial verbose payload to a fully-defined `IIdentityVerbose`,
 * substituting the UNKNOWN sentinels when the shape is wrong. Defensive
 * against test mocks that return `false`/`true`/strings from `evaluate(...)`
 * rather than the structured payload.
 * @param obj - Partial payload from evaluate.
 * @returns Verbose shape with all fields defined.
 */
function normalizeVerbose(obj: Partial<IIdentityVerbose>): IIdentityVerbose {
  const identity = obj.identity ?? UNKNOWN_IDENTITY;
  const outerHtml = resolveOuterHtml(obj);
  return { identity, outerHtml };
}

/**
 * Capture the resolved element's identity payload (browser-side eval).
 *
 * <p>MUST be a top-level pure function (no captured closures) so
 * Playwright's `evaluate(...)` serialisation can transport it into the
 * page context. The attribute construction is INTENTIONALLY inlined
 * (not delegated to a sibling helper like `extractIdentityAttrs`)
 * because the page context would not have the helper symbol available
 * — Playwright `evaluate(fn, arg)` transports only the function body
 * source plus the serialisable `arg`. A free reference to a module-
 * scope helper would crash at runtime with `ReferenceError`. Passing
 * the helper as `arg` requires non-serialisable JS / an `unknown` cast
 * the project ban-list rejects.
 *
 * The body therefore enumerates the attribute reads explicitly, which
 * also keeps the attribute → identity-field mapping locally auditable.
 * @param el - The DOM element under inspection (browser context).
 * @param max - Max length for the outerHTML snippet.
 * @returns Verbose identity payload (identity bundle + bounded outerHTML).
 */
function snapshotIdentityInBrowser(el: Element, max: number): IIdentityVerbose {
  const identity = {
    tag: el.tagName,
    id: el.id || '(none)',
    classes: el.className || '(none)',
    name: el.getAttribute('name') ?? '(none)',
    type: el.getAttribute('type') ?? '(none)',
    ariaLabel: el.getAttribute('aria-label') ?? '(none)',
    title: el.getAttribute('title') ?? '(none)',
    href: el.getAttribute('href') ?? '(none)',
  };
  const outerHtml = (el.outerHTML || '').slice(0, max);
  return { identity, outerHtml };
}

/**
 * Run the browser-side identity snapshot for an entry and normalise the
 * payload against malformed test mocks (which may return `false` / strings
 * instead of the structured shape).
 * @param entry - The winning locator entry.
 * @returns Verbose payload (never with missing fields).
 */
async function extractIdentityVerbose(entry: ILocatorEntry): Promise<IIdentityVerbose> {
  const evaluated = await entry.locator
    .evaluate(snapshotIdentityInBrowser, OUTER_HTML_SNIPPET_MAX)
    .catch((): IIdentityVerbose => UNKNOWN_VERBOSE);
  return normalizeVerbose(evaluated);
}

/**
 * Build the attribute sub-payload with PII masking applied to free-text
 * fields. `name` and `type` are HTML form-control attributes (structural,
 * not PII). `ariaLabel`, `title`, and `href` can carry banking text such
 * as account labels, balances, or transaction-scoped URLs on the
 * post-login surface — those flow through {@link maskVisibleText} so the
 * 30-char cap and PII_REDACTION env knob both apply to debug logs.
 * @param identity - Element identity bundle.
 * @returns Masked attribute payload ready to embed under `attrs`.
 */
function buildAttrsPayload(identity: IElementIdentity): object {
  return {
    name: identity.name,
    type: identity.type,
    ariaLabel: maskVisibleText(identity.ariaLabel),
    title: maskVisibleText(identity.title),
    href: maskVisibleText(identity.href),
  };
}

/**
 * Build the LOG.debug payload from the identity bundle. Top-level so the
 * caller (`traceElementIdentity`) stays under cap by delegating both the
 * sub-attrs projection and the outer-shape composition here.
 *
 * <p>Free-text fields are masked via {@link maskVisibleText} so the
 * post-login DOM trace cannot accidentally surface customer-scoped HTML
 * (account labels, balances, last-4 card suffixes) at debug level. The
 * `outerHtml` snippet is 300 chars wide and is the most likely vector
 * for unintended PII leakage on banking surfaces — masking it caps the
 * surfaced slice at {@link MAX_VISIBLE_TEXT_LENGTH} (30 chars) in
 * production / CI and leaves it untouched only when
 * `PII_REDACTION=off` is explicitly set for local debug.
 * @param identity - Element identity bundle.
 * @param outerHtml - Bounded outerHTML snippet.
 * @returns Pino-shaped object ready for LOG.debug (PII-masked).
 */
function buildIdentityLogPayload(identity: IElementIdentity, outerHtml: string): object {
  return {
    tag: identity.tag,
    domId: identity.id,
    classes: identity.classes,
    attrs: buildAttrsPayload(identity),
    outerHtml: maskVisibleText(outerHtml),
    visibility: 'visible',
  };
}

/**
 * Emit the DOM identity bundle at debug level. The `domId` key (not `id`)
 * bypasses the credential-id Pino redaction — DOM ids on a public commercial
 * site are not PII.
 * @param identity - The element identity bundle.
 * @param outerHtml - Bounded outerHTML snippet from the same element.
 * @returns Sentinel ``true`` once the log has been emitted.
 */
function traceElementIdentity(identity: IElementIdentity, outerHtml: string): true {
  const payload = buildIdentityLogPayload(identity, outerHtml);
  LOG.debug(payload);
  return true;
}

/**
 * Snapshot the resolved element's DOM identity (tag, id, classes, attrs)
 * plus a bounded outerHTML, log the bundle at debug level, and return the
 * identity for ACTION-stage selector building. The trace emit uses `domId`
 * (not `id`) so the public DOM identity bypasses the credential-id Pino
 * redaction — DOM ids on a public commercial site are not PII.
 * @param entry - The winning locator entry.
 * @returns Identity object captured during PRE.
 */
export async function extractAndTraceIdentity(entry: ILocatorEntry): Promise<IElementIdentity> {
  const { identity, outerHtml } = await extractIdentityVerbose(entry);
  traceElementIdentity(identity, outerHtml);
  return identity;
}
