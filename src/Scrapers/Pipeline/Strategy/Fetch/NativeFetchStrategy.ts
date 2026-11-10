/**
 * Native fetch strategy — uses globalThis.fetch for API-only scrapers (no browser).
 * Caller-supplied extraHeaders WIN on collision with the default content-type.
 * Every async path returns Procedure<T>; no thrown errors escape the class.
 *
 * A bank may ask for a per-request cap (`timeoutMs`): the strategy then installs
 * the capped invoke seam, supports response-integrity policies, and can name the
 * default headers each verb sends. Without a cap every behaviour stays the base
 * fetch behaviour. Assembly lives in the API-mediator factory, not in inheritance.
 */

import type {
  IResponseIntegrity,
  IResponseReading,
  MediaTypePolicy,
  RedirectPolicy,
  StatusPolicy,
} from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import makeInvokeCapped from './CappedInvoke.js';
import type {
  FetchInvoke,
  HttpVerb,
  IFetchOpts,
  IFetchStrategy,
  PostData,
} from './FetchStrategy.js';
import { overlayHeaders } from './HeaderOverlay.js';
import type { IDispatch } from './NativeFetchDispatch.js';
import { dispatchFetch } from './NativeFetchDispatch.js';
import type { FullyQualifiedUrl } from './NativeFetchNetwork.js';
import { INVOKE_NATIVE_FETCH, refuseBody, resolveFetchUrl } from './NativeFetchNetwork.js';
import { withBodyContentType, writePostBody } from './PostBody.js';
import type { IRedirectRun } from './RedirectFollow.js';
import { checkResponseIntegrity } from './ResponsePolicyCheck.js';

/** The request half of a run — what a verb method builds before policy. */
type TRequest = Pick<IRedirectRun, 'url' | 'init' | 'verb'>;

/** Default request headers per verb, merged under the caller's headers. */
type DefaultHeadersByVerb = Readonly<Record<HttpVerb, Readonly<Record<string, string>>>>;

/** Bank-wide policies shared by native REST and GraphQL transports. */
interface INativeFetchOptions {
  readonly redirectPolicy?: RedirectPolicy;
  readonly statusPolicy?: StatusPolicy;
  readonly omitBankText?: boolean;
  /** Media type each response kind must name when a call names none. */
  readonly mediaTypes?: MediaTypePolicy;
  /** Decode every answer as strict UTF-8 unless its call says otherwise. */
  readonly strictUtf8?: boolean;
  readonly responseIntegrity?: IResponseIntegrity;
  readonly isConnectRetryDisabled?: boolean;
  /**
   * Ceiling (ms) for one request, connect through the full body. Setting it
   * installs the capped invoke and lets the transport enforce response
   * integrity; leaving it out keeps the uncapped base transport.
   */
  readonly timeoutMs?: number;
  /** Headers each verb sends under the caller's; absent keeps JSON on every verb. */
  readonly defaultHeaders?: DefaultHeadersByVerb;
  /**
   * Install the cap only when the call names a response-integrity policy.
   * GraphQL uses this so an unbounded query keeps the base transport.
   */
  readonly capOnlyWithIntegrity?: boolean;
}

/** JSON content-type on every verb — the base strategy's defaults. */
const JSON_DEFAULT_HEADERS: DefaultHeadersByVerb = {
  GET: { 'content-type': 'application/json' },
  POST: { 'content-type': 'application/json' },
};

/** Capped transport defaults: a GET has no body, so only POST names JSON. */
const CAPPED_DEFAULT_HEADERS: DefaultHeadersByVerb = {
  GET: {},
  POST: { 'content-type': 'application/json' },
};

/** Native fetch — uses globalThis.fetch with merged default headers. */
class NativeFetchStrategy implements IFetchStrategy {
  protected readonly _baseUrl: string;

  /**
   * Transport seam — performs the raw request. Defaults to globalThis.fetch;
   * mTLS subclasses replace it in their constructor with a client-cert
   * transport. All downstream response parsing, cookie emission, and logging
   * stay in the shared dispatch pipeline regardless of transport.
   */
  protected _invoke: FetchInvoke = INVOKE_NATIVE_FETCH;

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
   * Status seam — the statuses this transport's bank decides itself.
   * The base decides none; transports built for a bank whose config names a
   * policy replace it in their constructor.
   */
  protected _statusPolicy: StatusPolicy = {};

  /** Drop response snippets from HTTP failures without changing WAF classification. */
  protected readonly _omitBankText: boolean;

  /**
   * Media type seam — the type each response kind's answer must name
   * when the call names none. The base expects none; transports built for a
   * bank whose config names defaults replace it in their constructor.
   */
  protected _mediaTypes: MediaTypePolicy = {};

  /**
   * Strict UTF-8 seam — whether an answer whose call names no choice is
   * decoded as strict UTF-8. The base reads bodies as `text()` does;
   * transports built for a strict bank replace it in their constructor.
   */
  protected _strictUtf8 = false;

  /** The transport must explicitly opt in only after implementing enforcement. */
  protected _supportsResponseIntegrity = false;

  protected readonly _responseIntegrity?: IResponseIntegrity;

  protected readonly _isConnectRetryDisabled: boolean;

  /** Per-request ceiling; absent keeps the uncapped base transport. */
  private readonly _timeoutMs?: number;

  /** Keep the base transport for calls that name no integrity policy. */
  private readonly _capOnlyWithIntegrity: boolean;

  /**
   * Create a NativeFetchStrategy.
   * @param baseUrl - The base URL for API requests.
   * @param options - Bank defaults; absent policies retain ordinary fetch behavior.
   */
  constructor(baseUrl: string, options: INativeFetchOptions = {}) {
    this._baseUrl = baseUrl;
    this._timeoutMs = options.timeoutMs;
    this._capOnlyWithIntegrity = options.capOnlyWithIntegrity === true;
    this._verbDefaults = options.defaultHeaders ?? this._verbDefaults;
    this._redirectDefault = options.redirectPolicy ?? this._redirectDefault;
    this._statusPolicy = options.statusPolicy ?? this._statusPolicy;
    this._omitBankText = options.omitBankText === true;
    this._mediaTypes = options.mediaTypes ?? this._mediaTypes;
    this._strictUtf8 = options.strictUtf8 ?? this._strictUtf8;
    this._responseIntegrity = options.responseIntegrity;
    this._isConnectRetryDisabled = options.isConnectRetryDisabled === true;
    this._supportsResponseIntegrity = this._timeoutMs !== undefined;
  }

  /**
   * POST a body via the configured transport, written under the call's
   * body encoding (JSON when it names none). A body its writer refuses
   * fails before any request.
   * @param url - Target URL (absolute, or relative to baseUrl).
   * @param data - POST body.
   * @param opts - Fetch options (caller extraHeaders override defaults).
   * @returns Procedure with parsed response or structured failure.
   */
  public async fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    const integrity = this.checkIntegrity(opts);
    if (!isOk(integrity)) return integrity;
    const written = writePostBody(data, opts.bodyEncoding);
    const target = this.resolveUrl(url);
    if (!isOk(written)) return refuseBody<T>(target, written, opts.redactUrlValues);
    const merged = overlayHeaders(this._verbDefaults.POST, opts.extraHeaders);
    const headers = withBodyContentType(merged, written.value);
    const body =
      written.value.contentType === false
        ? new TextEncoder().encode(written.value.body)
        : written.value.body;
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
    const integrity = this.checkIntegrity(opts);
    if (!isOk(integrity)) return integrity;
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
    const invoke = this.invokeFor(reading);
    const hooks = { onSetCookie: opts.onSetCookie, sessionHeadersFor: opts.sessionHeadersFor };
    const redaction = { redactUrlValues: opts.redactUrlValues };
    const invocation = { invoke, mediaType: reading.mediaType, ...redaction };
    return { ...request, ...hooks, ...invocation, url, policy, reading };
  }

  /**
   * How a call's answer is read: this transport's status policy plus the
   * call's response kind (`json` when absent), document marker, text cap,
   * header sink, media type (else this transport's default for the kind) and
   * strict UTF-8 choice (else this transport's).
   * @param opts - The call's fetch options.
   * @returns The reading routeResponse applies.
   */
  protected readingOf(opts: IFetchOpts): IResponseReading {
    const responseKind = opts.responseKind ?? 'json';
    const { documentMarker, maxTextChars, headerSink, onEmptyResponse } = opts;
    const media = { mediaType: opts.mediaType ?? this._mediaTypes[responseKind] };
    const decoding = { strictUtf8: opts.strictUtf8 ?? this._strictUtf8 };
    const hooks = { responseKind, documentMarker, maxTextChars, headerSink, onEmptyResponse };
    const redaction = { redactUrlValues: opts.redactUrlValues };
    const privacy = { omitBankText: this._omitBankText };
    const policy = {
      statusPolicy: this._statusPolicy,
      responseIntegrity: opts.responseIntegrity ?? this._responseIntegrity,
    };
    return { ...policy, ...hooks, ...media, ...decoding, ...privacy, ...redaction };
  }

  /**
   * Resolve a URL against the instance baseUrl (absolute URLs pass through).
   * @param url - Caller-supplied URL (absolute or relative).
   * @returns The fully-qualified URL suitable for globalThis.fetch.
   */
  protected resolveUrl(url: string): FullyQualifiedUrl {
    return resolveFetchUrl(this._baseUrl, url);
  }

  /**
   * Pick the transport seam for one call: the capped one when the transport
   * has a ceiling and is allowed to apply it here, otherwise the base seam.
   * @param reading - The call's immutable reading policy.
   * @returns The request-local transport.
   */
  private invokeFor(reading: IResponseReading): FetchInvoke {
    const timeoutMs = this._timeoutMs;
    if (timeoutMs === undefined) return this._invoke;
    if (this._capOnlyWithIntegrity && reading.responseIntegrity === undefined) return this._invoke;
    return makeInvokeCapped(timeoutMs, reading, this._isConnectRetryDisabled);
  }

  /**
   * Checks both default and per-call policies before a request is dispatched.
   * @param opts - Call options that may override the default.
   * @returns A policy refusal or permission to continue.
   */
  private checkIntegrity(opts: IFetchOpts): Procedure<void> {
    const bank = checkResponseIntegrity(this._responseIntegrity, this._supportsResponseIntegrity);
    if (!isOk(bank)) return bank;
    return checkResponseIntegrity(opts.responseIntegrity, this._supportsResponseIntegrity);
  }
}

export default NativeFetchStrategy;
export { CAPPED_DEFAULT_HEADERS, NativeFetchStrategy };
export { isApiSuccess } from './NativeFetchDispatch.js';
export { invokeFetch, resolveFetchUrl, toNetworkFailure } from './NativeFetchNetwork.js';
export type { DefaultHeadersByVerb, INativeFetchOptions, TRequest };
export type { FetchInvoke, HttpVerb } from './FetchStrategy.js';
export type { IDispatch } from './NativeFetchDispatch.js';
export type { FullyQualifiedUrl } from './NativeFetchNetwork.js';
