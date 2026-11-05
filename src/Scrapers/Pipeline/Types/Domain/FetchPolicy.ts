/**
 * Fetch policy — how one call treats a redirect (N2), how it reads its answer
 * (N3), which 2xx statuses the bank decides itself (N4), which response
 * headers the caller reads (N6) and how it writes a POST body (N9). A pure DTO leaf
 * at layer 5 so bank config (Registry), step config (Mediator), the per-call
 * bus options and the transports (Strategy) share one contract.
 */

/** One allowed redirect target: exact https origin, exact path, query rules. */
interface IExactPathRule {
  /** Exact `scheme://host[:port]` in `URL.origin` form; https only. */
  readonly origin: string;
  /** Allowed paths, compared exactly but case-insensitively. */
  readonly paths: readonly string[];
  /** Query keys that must appear once, each with exactly this value. */
  readonly query?: Readonly<Record<string, string>>;
  /** When true no other key and no duplicate key may appear (no `query` ⇒ none). */
  readonly exactQuery?: boolean;
}

/** Any path and query on one exact https origin, except paths holding a denied text. */
interface IAnyPathExceptRule {
  /** Exact `scheme://host[:port]` in `URL.origin` form; https only. */
  readonly origin: string;
  /** Texts the lower-cased path must not contain, compared case-insensitively. */
  readonly anyPathExcept: readonly string[];
}

/** One allowed URL: an exact path rule or an any-path-except rule. */
type IUrlRule = IExactPathRule | IAnyPathExceptRule;

/** Follow up to `maxHops` redirects whose target matches one rule (GET steps only). */
interface IManualRedirect {
  readonly maxHops: number;
  readonly allow: readonly IUrlRule[];
}

/**
 * `follow` lets fetch follow redirects (the default); `reject` fails on any
 * 3xx; an {@link IManualRedirect} follows only allowed hops.
 */
type RedirectPolicy = 'follow' | 'reject' | IManualRedirect;

/**
 * `json` parses the body (the default); `document` reads it as text and
 * discards it; `text` hands it over as `{ text }`, up to the call's
 * `maxTextChars` (65 536 by default).
 */
type ResponseKind = 'json' | 'document' | 'text';

/**
 * `json` sends the POST body as JSON (the default); `form` sends a flat record
 * URL-encoded; `form-latin1` does the same over ISO-8859-1; `text` sends the
 * one string field of a `{ text }` record verbatim, with no content-type.
 */
type BodyEncoding = 'json' | 'form' | 'form-latin1' | 'text';

/** Encodings that write a flat record field by field. */
const FORM_BODY_ENCODINGS: readonly BodyEncoding[] = ['form', 'form-latin1'];

/** `empty` answers `{}` without reading the body; `fail` refuses the call. */
type StatusAction = 'empty' | 'fail';

/** A bank's 2xx statuses it decides before the body is read. */
type StatusPolicy = Readonly<Partial<Record<number, StatusAction>>>;

/** The response headers a call reads (N6, N31): their names and their receiver. */
interface IResponseHeaderSink {
  /** Lower-case header names; only these reach `take`. */
  readonly names: readonly string[];
  /**
   * Receives the named headers, the HTTP status and the URL that gave each
   * answer (N51: after any hops, the last one); returns how many headers.
   */
  readonly take: (headers: Readonly<Record<string, string>>, status: number, url: string) => number;
}

/** Per-call transport policy a step hands to the bus. */
interface IFetchCallPolicy {
  /** Overrides the bank's default redirect policy for this call. */
  readonly redirect?: RedirectPolicy;
  /** How the call reads a 2xx answer; `json` when absent. */
  readonly responseKind?: ResponseKind;
  /** Text a `document` answer must contain, else the call fails. */
  readonly documentMarker?: string;
  /** Longest `text` answer the call accepts, in chars; 65 536 when absent. */
  readonly maxTextChars?: number;
  /** Receives the declared headers of the final response; native transports only. */
  readonly headerSink?: IResponseHeaderSink;
  /** How a POST body is written; `json` when absent; native transports only. */
  readonly bodyEncoding?: BodyEncoding;
}

/** How a transport reads one answered call: the bank's policy plus the call's own. */
interface IResponseReading {
  readonly statusPolicy: StatusPolicy;
  readonly responseKind: ResponseKind;
  /** Omit the response snippet from generic HTTP failures, not WAF classification. */
  readonly omitBankText?: boolean;
  readonly documentMarker?: string;
  readonly maxTextChars?: number;
  readonly headerSink?: IResponseHeaderSink;
  /** Internal notification of a policy-approved empty response; returns a recorded-event count. */
  readonly onEmptyResponse?: () => number;
}

/** Fixed reason a transport reports for a refused redirect. */
const REDIRECT_REFUSED_REASON = 'redirect refused';

/** Fixed reason a transport reports for a document missing its marker. */
const DOCUMENT_UNVERIFIED_REASON = 'document unverified';

/** Fixed reason a transport reports for a `text` answer over its cap. */
const TEXT_TOO_LONG_REASON = 'text too long';

/** Fixed reason a transport reports for a latin1 form holding a char above U+00FF. */
const LATIN1_UNENCODABLE_REASON = 'form-latin1 unencodable';

/** Fixed reason a transport reports for a `text` body that is not one string field. */
const TEXT_BODY_REFUSED_REASON = 'text body not a string';

export type {
  BodyEncoding,
  IAnyPathExceptRule,
  IExactPathRule,
  IFetchCallPolicy,
  IManualRedirect,
  IResponseHeaderSink,
  IResponseReading,
  IUrlRule,
  RedirectPolicy,
  ResponseKind,
  StatusAction,
  StatusPolicy,
};
export {
  DOCUMENT_UNVERIFIED_REASON,
  FORM_BODY_ENCODINGS,
  LATIN1_UNENCODABLE_REASON,
  REDIRECT_REFUSED_REASON,
  TEXT_BODY_REFUSED_REASON,
  TEXT_TOO_LONG_REASON,
};
