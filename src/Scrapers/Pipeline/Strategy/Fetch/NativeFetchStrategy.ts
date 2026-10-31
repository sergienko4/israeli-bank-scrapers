/**
 * Native fetch strategy — uses globalThis.fetch for API-only scrapers (no browser).
 * Caller-supplied extraHeaders WIN on collision with the default content-type.
 * Every async path returns Procedure<T>; no thrown errors escape the class.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { getDebug } from '../../Logging/Debug.js';
import type { Brand } from '../../Types/Brand.js';
import type {
  IResponseReading,
  RedirectPolicy,
  ResponseKind,
  StatusPolicy,
} from '../../Types/Domain/FetchPolicy.js';
import { toError } from '../../Types/ErrorUtils.js';
import { describeJsonParseFailure } from '../../Types/JsonParseFailure.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { readDocument } from './DocumentResponse.js';
import type {
  FetchInvoke,
  HttpVerb,
  IFetchOpts,
  IFetchStrategy,
  PostData,
} from './FetchStrategy.js';
import { overlayHeaders } from './HeaderOverlay.js';
import { classifyHttpFailure, hasCloudflareChallengeHeader } from './HttpFailureClassifier.js';
import type { IRedirectRun } from './RedirectFollow.js';
import { emitSetCookies, sendUnderPolicy } from './RedirectFollow.js';
import { safeUrlForLog, scrubUrlFromText } from './SafeUrlForLog.js';
import type { IAnswer } from './StatusPolicy.js';
import { applyStatusPolicy } from './StatusPolicy.js';

type FullyQualifiedUrl = Brand<string, 'FullyQualifiedUrl'>;

/** The request half of a run — what a verb method builds before policy. */
type TRequest = Pick<IRedirectRun, 'url' | 'init' | 'verb'>;

/** A run plus how its answer is read. */
interface IDispatch extends IRedirectRun {
  readonly reading: IResponseReading;
}

/** Reads a 2xx answer the status policy left undecided. */
type Reader = <T>(answer: IAnswer) => Promise<Procedure<T>>;

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** Default request headers per verb, merged under the caller's headers. */
type DefaultHeadersByVerb = Readonly<Record<HttpVerb, Readonly<Record<string, string>>>>;

/** JSON content-type on every verb — the base strategy's defaults. */
const JSON_DEFAULT_HEADERS: DefaultHeadersByVerb = {
  GET: { 'content-type': 'application/json' },
  POST: { 'content-type': 'application/json' },
};

/**
 * Parse an answer's body as JSON, with a structured failure on malformed input.
 * @param answer - The answered call.
 * @returns Procedure carrying the parsed body, or a parse-error failure.
 */
async function parseJsonResponse<T>(answer: IAnswer): Promise<Procedure<T>> {
  const rawText = await answer.response.text();
  try {
    const parsed = JSON.parse(rawText) as T;
    return succeed(parsed);
  } catch (error) {
    const reason = describeJsonParseFailure(error);
    const safeUrl = safeUrlForLog(answer.url);
    return fail(ScraperErrorTypes.Generic, `${answer.verb} ${safeUrl} parse error: ${reason}`);
  }
}

/** Reader per response kind; both run after WAF classification and the status policy. */
const READERS: Readonly<Record<ResponseKind, Reader>> = {
  json: parseJsonResponse,
  document: readDocument,
};

/**
 * Classify a failed or challenged answer into a Procedure failure.
 * @param answer - The answered call: non-2xx, or a 2xx challenge.
 * @returns WafBlocked for a Cloudflare edge refusal, else Generic with a snippet.
 */
async function classifyStatus<T>(answer: IAnswer): Promise<Procedure<T>> {
  const { response, verb, url } = answer;
  const body = await response.text();
  const headers = Object.fromEntries(response.headers);
  return classifyHttpFailure<T>({ verb, url, status: response.status, body, headers });
}

/**
 * Whether a Response carries an API body: a 2xx that is not an edge
 * challenge (Cloudflare does not tie its challenge header to a status).
 * @param response - The fetch Response returned by globalThis.fetch.
 * @returns True when the body should be read as the API's answer.
 */
function isApiSuccess(response: Response): boolean {
  if (!response.ok) return false;
  const headers = Object.fromEntries(response.headers);
  return !hasCloudflareChallengeHeader(headers);
}

/**
 * Route an answer: WAF classification first, then the bank's status policy,
 * then the reader its response kind names.
 * @param answer - The answered call.
 * @returns Procedure with the read body or a classified failure.
 */
function routeResponse<T>(answer: IAnswer): Promise<Procedure<T>> {
  if (!isApiSuccess(answer.response)) return classifyStatus<T>(answer);
  const decided = applyStatusPolicy<T>(answer);
  if (decided.has) return Promise.resolve(decided.value);
  return READERS[answer.reading.responseKind]<T>(answer);
}

/**
 * Wrap a thrown fetch error into a network-error Procedure.
 * @param error - The caught value, from any realm.
 * @param verb - HTTP verb (for error-message prefixing).
 * @param url - Target URL (for error-message prefixing).
 * @returns Procedure failure annotated with the underlying reason.
 */
function toNetworkFailure(error: unknown, verb: HttpVerb, url: string): Procedure<Response> {
  const rawReason = toError(error).message;
  const reason = scrubUrlFromText(rawReason, url);
  const safeUrl = safeUrlForLog(url);
  return fail(ScraperErrorTypes.Generic, `${verb} ${safeUrl} network error: ${reason}`);
}

/**
 * Run globalThis.fetch and surface the Response or a network-error Procedure.
 * @param url - Target URL.
 * @param init - Native fetch RequestInit (method/headers/body).
 * @param verb - HTTP verb (for error-message prefixing).
 * @returns Procedure carrying the raw Response, or a network-error failure.
 */
async function invokeFetch(
  url: string,
  init: RequestInit,
  verb: HttpVerb,
): Promise<Procedure<Response>> {
  try {
    const response = await globalThis.fetch(url, init);
    return succeed(response);
  } catch (error) {
    return toNetworkFailure(error, verb, url);
  }
}

/**
 * Resolve a request URL the way every node transport does: an absolute
 * http(s) URL passes through, anything else is appended to the base URL.
 * @param baseUrl - The transport's base URL.
 * @param url - Caller-supplied URL (absolute or relative).
 * @returns The fully-qualified URL suitable for globalThis.fetch.
 */
function resolveFetchUrl(baseUrl: string, url: string): FullyQualifiedUrl {
  if (url.startsWith('http://') || url.startsWith('https://')) return url as FullyQualifiedUrl;
  return `${baseUrl}${url}` as FullyQualifiedUrl;
}

/**
 * Send a run under its redirect policy and route success/non-2xx through the
 * helpers. The final response's Set-Cookie lines are filed under the URL that
 * answered (manual hops file their own on the way). Emits PII-safe DEBUG
 * traces at fire and after-status. Per `logging-pii-guidlines.txt`, the URL
 * is stripped of query string (which may carry session ids / tokens) first.
 * @param run - url + init + verb + invoke transport + policies + cookie hooks.
 * @returns Procedure with parsed body or structured failure.
 */
async function dispatchFetch<T>(run: IDispatch): Promise<Procedure<T>> {
  const safeUrl = safeUrlForLog(run.url);
  LOG.debug({ verb: run.verb, url: safeUrl, message: '[fetch] FIRE' });
  const sent = await sendUnderPolicy(run);
  if (!isOk(sent)) {
    const errorMessage = sent.errorMessage;
    LOG.debug({ verb: run.verb, url: safeUrl, errorMessage, message: '[fetch] NETWORK FAIL' });
    return sent;
  }
  const { response, responseUrl } = sent.value;
  LOG.debug({ verb: run.verb, url: safeUrl, status: response.status, message: '[fetch] STATUS' });
  emitSetCookies(response, responseUrl, run.onSetCookie);
  return routeResponse<T>({ response, verb: run.verb, url: run.url, reading: run.reading });
}

/** Native fetch — uses globalThis.fetch with merged JSON headers. */
class NativeFetchStrategy implements IFetchStrategy {
  protected readonly _baseUrl: string;

  /**
   * Transport seam — performs the raw request. Defaults to globalThis.fetch;
   * mTLS subclasses replace it in their constructor with a client-cert
   * transport. All downstream response parsing, cookie emission, and logging
   * stay in the shared dispatchFetch pipeline regardless of transport.
   */
  protected _invoke: FetchInvoke = invokeFetch;

  /**
   * Default-headers seam — the headers each verb sends under the caller's.
   * Subclasses replace it in their constructor; the base sends JSON
   * content-type on every verb.
   */
  protected _verbDefaults: DefaultHeadersByVerb = JSON_DEFAULT_HEADERS;

  /**
   * Redirect seam — the policy a call runs under when it names none. The
   * base lets fetch follow redirects; transports built for a bank whose
   * config names a policy replace it in their constructor.
   */
  protected _redirectDefault: RedirectPolicy = 'follow';

  /**
   * Status seam — the 2xx statuses this transport's bank decides itself.
   * The base decides none; transports built for a bank whose config names a
   * policy replace it in their constructor.
   */
  protected _statusPolicy: StatusPolicy = {};

  /**
   * Create a NativeFetchStrategy.
   * @param baseUrl - The base URL for API requests.
   */
  constructor(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  /**
   * POST a JSON body via the configured transport.
   * @param url - Target URL (absolute, or relative to baseUrl).
   * @param data - POST body, serialised as JSON.
   * @param opts - Fetch options (caller extraHeaders override defaults).
   * @returns Procedure with parsed response or structured failure.
   */
  public async fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    const headers = overlayHeaders(this._verbDefaults.POST, opts.extraHeaders);
    const body = JSON.stringify(data);
    const init: RequestInit = { method: 'POST', headers, body };
    const run = this.toRun({ url, init, verb: 'POST' }, opts);
    return dispatchFetch<T>(run);
  }

  /**
   * GET via the configured transport.
   * @param url - Target URL (absolute, or relative to baseUrl).
   * @param opts - Fetch options (caller extraHeaders override defaults).
   * @returns Procedure with parsed response or structured failure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const headers = overlayHeaders(this._verbDefaults.GET, opts.extraHeaders);
    const init: RequestInit = { method: 'GET', headers };
    const run = this.toRun({ url, init, verb: 'GET' }, opts);
    return dispatchFetch<T>(run);
  }

  /**
   * Complete a request into a run: resolved URL, this transport's seam, the
   * call's redirect policy (else this transport's default), how its answer
   * is read and its hooks.
   * @param request - The verb method's URL, init and verb.
   * @param opts - The call's fetch options.
   * @returns The run dispatchFetch sends.
   */
  protected toRun(request: TRequest, opts: IFetchOpts): IDispatch {
    const url = this.resolveUrl(request.url);
    const policy = opts.redirect ?? this._redirectDefault;
    const reading = this.readingOf(opts);
    const { onSetCookie, cookieHeaderFor } = opts;
    const hooks = { onSetCookie, cookieHeaderFor };
    return { ...request, ...hooks, url, invoke: this._invoke, policy, reading };
  }

  /**
   * How a call's answer is read: this transport's status policy plus the
   * call's response kind (`json` when absent) and document marker.
   * @param opts - The call's fetch options.
   * @returns The reading routeResponse applies.
   */
  protected readingOf(opts: IFetchOpts): IResponseReading {
    const responseKind = opts.responseKind ?? 'json';
    const { documentMarker } = opts;
    return { statusPolicy: this._statusPolicy, responseKind, documentMarker };
  }

  /**
   * Resolve a URL against the instance baseUrl (absolute URLs pass through).
   * @param url - Caller-supplied URL (absolute or relative).
   * @returns The fully-qualified URL suitable for globalThis.fetch.
   */
  protected resolveUrl(url: string): FullyQualifiedUrl {
    return resolveFetchUrl(this._baseUrl, url);
  }
}

export default NativeFetchStrategy;
export { invokeFetch, NativeFetchStrategy, resolveFetchUrl, toNetworkFailure };
export type { DefaultHeadersByVerb, FullyQualifiedUrl };
export type { FetchInvoke, HttpVerb } from './FetchStrategy.js';
