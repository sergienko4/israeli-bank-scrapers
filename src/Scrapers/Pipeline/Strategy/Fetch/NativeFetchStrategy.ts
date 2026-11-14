/**
 * Native fetch strategy — uses globalThis.fetch for HTTP-only scrapers.
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
  ResponseKind,
  StatusPolicy,
} from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk } from '../../Types/Procedure.js';
import makeInvokeCapped from './CappedInvoke.js';
import type { FetchInvoke, IFetchOpts, IFetchStrategy, PostData } from './FetchStrategy.js';
import { overlayHeaders } from './HeaderOverlay.js';
import type { IDispatch } from './NativeFetchDispatch.js';
import { dispatchFetch } from './NativeFetchDispatch.js';
import type { FullyQualifiedUrl } from './NativeFetchNetwork.js';
import { INVOKE_NATIVE_FETCH, refuseBody, resolveFetchUrl } from './NativeFetchNetwork.js';
import type { DefaultHeadersByVerb, INativeFetchOptions, TRequest } from './NativeFetchOptions.js';
import { JSON_DEFAULT_HEADERS, seedTransport } from './NativeFetchOptions.js';
import { withBodyContentType, writePostBody } from './PostBody.js';
import { checkResponseIntegrity } from './ResponsePolicyCheck.js';

/** The body text and content-type decision a POST writer produced. */
type TWrittenBody = Extract<ReturnType<typeof writePostBody>, { success: true }>['value'];

/**
 * Bytes to send for a written body: a body that removed its content-type is
 * sent as raw bytes, so the transport framing stays byte-exact.
 * @param written - The body its writer produced.
 * @returns The text, or its UTF-8 bytes when the writer removed the type.
 */
function encodedBody(written: TWrittenBody): BodyInit {
  if (written.contentType === false) return new TextEncoder().encode(written.body);
  return written.body;
}

/** The value a call's reading takes from this transport's defaults. */
interface IReadingDefaults {
  readonly mediaType?: string;
  readonly strictUtf8: boolean;
}

/** The transport-wide policy a reading applies to every answer. */
interface IReadingPolicy {
  readonly statusPolicy: StatusPolicy;
  readonly responseIntegrity?: IResponseIntegrity;
}

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
    const seed = seedTransport(options);
    this._timeoutMs = seed.timeoutMs;
    this._capOnlyWithIntegrity = seed.capOnlyWithIntegrity;
    this._omitBankText = seed.omitBankText;
    this._responseIntegrity = seed.responseIntegrity;
    this._isConnectRetryDisabled = seed.isConnectRetryDisabled;
    this.applySeams(options);
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
    const init = this.postInit(opts, written.value);
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
    const reading = this.readingDefaults(opts, responseKind);
    const hooks = { responseKind, documentMarker, maxTextChars, headerSink, onEmptyResponse };
    const privacy = { omitBankText: this._omitBankText, redactUrlValues: opts.redactUrlValues };
    const policy = this.readingPolicy(opts);
    const redirect = this.redirectBodyOf(opts);
    return { ...policy, ...hooks, ...reading, ...privacy, ...redirect };
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
   * Whether the call's redirect policy returns a 3xx as its answer, so the
   * capped reader must keep and check that body instead of releasing it.
   * @param opts - The call's fetch options.
   * @returns `keepRedirectBody` set for the `accept` policy.
   */
  private redirectBodyOf(opts: IFetchOpts): Pick<IResponseReading, 'keepRedirectBody'> {
    const redirect = opts.redirect ?? this._redirectDefault;
    return { keepRedirectBody: redirect === 'accept' };
  }

  /**
   * The media type and strict-decoding choice a call's reading applies.
   * @param opts - The call's fetch options.
   * @param responseKind - The call's response kind.
   * @returns This transport's defaults, overridden by the call's choices.
   */
  private readingDefaults(opts: IFetchOpts, responseKind: ResponseKind): IReadingDefaults {
    const mediaType = opts.mediaType ?? this._mediaTypes[responseKind];
    const isStrictUtf8 = opts.strictUtf8 ?? this._strictUtf8;
    return { mediaType, strictUtf8: isStrictUtf8 };
  }

  /**
   * The transport-wide policy and integrity override a call's reading applies.
   * @param opts - The call's fetch options.
   * @returns The status policy and effective integrity policy.
   */
  private readingPolicy(opts: IFetchOpts): IReadingPolicy {
    const responseIntegrity = opts.responseIntegrity ?? this._responseIntegrity;
    return { statusPolicy: this._statusPolicy, responseIntegrity };
  }

  /**
   * Install the mutable verb, redirect, status, media and decoding seams, plus
   * whether the installed cap lets the transport enforce response integrity.
   * @param options - Bank defaults; absent policies keep this transport's.
   * @returns True once every seam is installed.
   */
  private applySeams(options: INativeFetchOptions): boolean {
    this._verbDefaults = options.defaultHeaders ?? this._verbDefaults;
    this._redirectDefault = options.redirectPolicy ?? this._redirectDefault;
    this._statusPolicy = options.statusPolicy ?? this._statusPolicy;
    this._mediaTypes = options.mediaTypes ?? this._mediaTypes;
    this._strictUtf8 = options.strictUtf8 ?? this._strictUtf8;
    this._supportsResponseIntegrity = options.timeoutMs !== undefined;
    return true;
  }

  /**
   * Build a POST init from a written body and the call's headers.
   * @param opts - The call's fetch options.
   * @param written - The body its writer produced.
   * @returns Method, headers and the bytes to send.
   */
  private postInit(opts: IFetchOpts, written: TWrittenBody): RequestInit {
    const merged = overlayHeaders(this._verbDefaults.POST, opts.extraHeaders);
    const headers = withBodyContentType(merged, written);
    const body = encodedBody(written);
    return { method: 'POST', headers, body };
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
export { NativeFetchStrategy };
export type { FetchInvoke, HttpVerb } from './FetchStrategy.js';
export type { IDispatch } from './NativeFetchDispatch.js';
export { isApiSuccess } from './NativeFetchDispatch.js';
export type { FullyQualifiedUrl } from './NativeFetchNetwork.js';
export { invokeFetch, resolveFetchUrl, toNetworkFailure } from './NativeFetchNetwork.js';
export type { DefaultHeadersByVerb, INativeFetchOptions, TRequest } from './NativeFetchOptions.js';
export { CAPPED_DEFAULT_HEADERS } from './NativeFetchOptions.js';
