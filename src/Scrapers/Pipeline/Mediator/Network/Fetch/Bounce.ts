/**
 * Fetch sub-module — bounce classification for in-page fetch responses.
 *
 * When a bank's WAF answers an XHR with an HTML interstitial, or the session has
 * lapsed and the request is redirected to a login page, the response reaches the
 * parser as a body that cannot be JSON. Before this module the parser reported
 * that as `parse error: Unexpected token '<'` — technically true, diagnostically
 * useless, and indistinguishable from a genuine payload bug.
 *
 * `describeBounce` names the cause; `assertNotBounced` raises it as a typed
 * {@link WafBlockError}. The signal table is Open/Closed — a new detector is one
 * appended row, never an edit to the classifier — the same shape as
 * `WafChallengeSolverRegistry.ts` in the browser-side WAF interceptor.
 *
 * <p>Scope note: this is the **response** half of WAF handling. The interactive
 * checkbox-challenge half lives in `Pipeline/Interceptors/WafChallenge/`.
 */

import { WafBlockError } from '../../../../Base/Errors.js';
import type { Brand } from '../../../Types/Brand.js';
import { redactHtml, redactUrlFull } from '../../../Types/PiiRedactor.js';
import type { BounceReason } from './BounceConfig.js';
import { JSON_TYPE_MARKER } from './BounceConfig.js';
import { detectWafBlock } from './WafDetection.js';

/** Branded marker returned by {@link assertNotBounced} so Rule #15 passes. */
export type BounceChecked = Brand<true, 'BounceChecked'>;

/** Singleton checked-marker. */
const CHECKED: BounceChecked = true as BounceChecked;

/** Whether a body can still be handed to the JSON parser. */
type IsUsableJsonBody = Brand<boolean, 'IsUsableJsonBody'>;

/**
 * The facts about one fetch response needed to classify it.
 *
 * Narrowed to plain data — no `Response`, no `Page` — so the classifier is pure
 * and testable without a browser, and so the in-page evaluators remain free to
 * change how they collect these fields.
 */
export interface IResponseFacts {
  /** Response body text, empty for a 204. */
  readonly text: string;
  /** HTTP status code. */
  readonly status: number;
  /** Requested URL, used when no redirect target is known. */
  readonly url: string;
  /** Raw `content-type` header, absent when the server omitted it. */
  readonly contentType?: string;
  /** True when the browser followed one or more redirects. */
  readonly redirected?: boolean;
  /** URL the response was finally read from, when it differs from `url`. */
  readonly finalUrl?: string;
}

/**
 * The wire format returned by every in-page fetch evaluator.
 *
 * `[text, status, contentType?, redirected?, finalUrl?]`. The trailing slots are
 * optional because they were appended after the fact: a mock — or an evaluator
 * that has not been widened — yields a two-element tuple, and reading a missing
 * slot as `undefined` keeps that path on its original behaviour.
 */
export type PageFetchTuple = readonly [string, number, string?, boolean?, string?];

/**
 * Convert an evaluator tuple into classifier input.
 * @param tuple - The raw evaluator result.
 * @param url - The requested URL.
 * @returns Facts ready for {@link describeBounce} or {@link assertNotBounced}.
 */
export function toResponseFacts(tuple: PageFetchTuple, url: string): IResponseFacts {
  const [text, status, contentType, isRedirected, finalUrl] = tuple;
  return { text, status, url, contentType, redirected: isRedirected, finalUrl };
}

/**
 * One detector in the bounce table.
 *
 * `describe` returns the empty string when the signal does not fire, so adding a
 * detector never requires a second predicate method to be kept in sync.
 */
export interface IBounceSignal {
  /** Stable identifier for the signal, used in diagnostics. */
  readonly name: string;
  /** Reason text when the signal fires, empty string otherwise. */
  readonly describe: (facts: IResponseFacts) => BounceReason;
}

/**
 * Ask the parser itself whether a body is JSON.
 *
 * Sniffing for a `{` or `[` prefix only ever answered this for objects and
 * arrays, but `JSON.parse` also accepts the four primitive forms, and it
 * rejects a body that merely opens like a document. Delegating makes the
 * gate exact rather than approximate, which is what the no-regression
 * property depends on. The caller checks the content-type first, so a large
 * legitimate payload never reaches this and is not parsed twice.
 * @param trimmed - Whitespace-trimmed, non-empty response body.
 * @returns True when the body would survive `JSON.parse`.
 */
function canParseAsJson(trimmed: string): boolean {
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide whether the body could still be parsed as JSON.
 * @param facts - The response under classification.
 * @returns True when the parser should be allowed to proceed.
 */
function isUsableJsonBody(facts: IResponseFacts): IsUsableJsonBody {
  const type = (facts.contentType ?? '').toLowerCase();
  if (type.includes(JSON_TYPE_MARKER)) return true as IsUsableJsonBody;
  const trimmed = facts.text.trim();
  if (trimmed === '') return true as IsUsableJsonBody;
  return canParseAsJson(trimmed) as IsUsableJsonBody;
}

/** Reuses the status/body heuristic already used for WAF diagnostics. */
const WAF_SIGNAL: IBounceSignal = {
  name: 'waf',
  /**
   * Name the WAF provider when the status/body heuristic recognises one.
   * @param facts - The response under classification.
   * @returns The reason, or the empty string when no WAF was recognised.
   */
  describe: (facts): BounceReason => {
    const waf = detectWafBlock(facts.status, facts.text);
    if (!waf) return '' as BounceReason;
    return `WAF block (${waf})` as BounceReason;
  },
};

/** A non-JSON body reached through a redirect is almost always a login bounce. */
const REDIRECT_SIGNAL: IBounceSignal = {
  name: 'redirect',
  /**
   * Name the redirect target the response was finally read from.
   * @param facts - The response under classification.
   * @returns The reason, or the empty string when no redirect was followed.
   */
  describe: (facts): BounceReason => {
    if (facts.redirected !== true) return '' as BounceReason;
    const target = redactUrlFull(facts.finalUrl ?? facts.url);
    return `redirected to ${target}` as BounceReason;
  },
};

/**
 * The signal table, consulted in order.
 *
 * Open/Closed: extend by appending a row. `describeBounce` never changes.
 */
const BOUNCE_SIGNALS: readonly IBounceSignal[] = [WAF_SIGNAL, REDIRECT_SIGNAL];

/**
 * Name why a response was bounced.
 *
 * A usable JSON body short-circuits to "not bounced" regardless of status, which
 * is what keeps a 429 or 503 carrying a real envelope retryable.
 *
 * Every signal is evaluated once, up front. That is deliberate: the table is
 * only consulted for a response that already failed the JSON gate, so the
 * healthy path never reaches it, and evaluating each `describe` exactly once
 * keeps a signal free to be more than a pure predicate.
 * @param facts - The response under classification.
 * @returns The reason, or the empty string when the response was answered.
 */
export function describeBounce(facts: IResponseFacts): BounceReason {
  const isUsable = isUsableJsonBody(facts);
  if (isUsable) return '' as BounceReason;
  const reasons = BOUNCE_SIGNALS.map((signal): BounceReason => signal.describe(facts));
  const hit = reasons.find((reason): boolean => reason !== '');
  return hit ?? ('' as BounceReason);
}

/**
 * Raise a typed error when a response was bounced.
 *
 * Honours the caller's ignore-errors contract first, so an opportunistic probe
 * that already tolerates failure keeps its existing behaviour. The captured
 * snippet is redacted rather than merely truncated: a login-page bounce echoes
 * the customer's own details back in the markup.
 * @param facts - The response under classification.
 * @param shouldIgnore - True when the caller opted out of error reporting.
 * @returns Branded marker when the response may proceed to the parser.
 * @throws {WafBlockError} When the response was bounced and errors are not ignored.
 */
export function assertNotBounced(facts: IResponseFacts, shouldIgnore: boolean): BounceChecked {
  if (shouldIgnore) return CHECKED;
  const reason = describeBounce(facts);
  if (!reason) return CHECKED;
  const blockedUrl = redactUrlFull(facts.finalUrl ?? facts.url);
  const snippet = redactHtml(facts.text);
  const details = { pageTitle: reason, responseSnippet: snippet };
  throw WafBlockError.apiBlock(facts.status, blockedUrl, details);
}
