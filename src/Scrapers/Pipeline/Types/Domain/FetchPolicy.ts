/**
 * Fetch policy — how one call treats a redirect (N2), how it reads its answer
 * (N3), which 2xx statuses the bank decides itself (N4) and which response
 * headers the caller reads (N6). A pure DTO leaf
 * at layer 5 so bank config (Registry), step config (Mediator), the per-call
 * bus options and the transports (Strategy) share one contract.
 */

/** One allowed redirect target: exact https origin, exact path, query rules. */
interface IUrlRule {
  /** Exact `scheme://host[:port]` in `URL.origin` form; https only. */
  readonly origin: string;
  /** Allowed paths, compared exactly but case-insensitively. */
  readonly paths: readonly string[];
  /** Query keys that must appear once, each with exactly this value. */
  readonly query?: Readonly<Record<string, string>>;
  /** When true no other key and no duplicate key may appear (no `query` ⇒ none). */
  readonly exactQuery?: boolean;
}

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

/** `json` parses the body (the default); `document` reads it as text and discards it. */
type ResponseKind = 'json' | 'document';

/** `empty` answers `{}` without reading the body; `fail` refuses the call. */
type StatusAction = 'empty' | 'fail';

/** A bank's 2xx statuses it decides before the body is read. */
type StatusPolicy = Readonly<Partial<Record<number, StatusAction>>>;

/** The response headers a call reads (N6): their names and their receiver. */
interface IResponseHeaderSink {
  /** Lower-case header names; only these reach `take`. */
  readonly names: readonly string[];
  /** Receives the named headers the final response carried; returns how many. */
  readonly take: (headers: Readonly<Record<string, string>>) => number;
}

/** Per-call transport policy a step hands to the bus. */
interface IFetchCallPolicy {
  /** Overrides the bank's default redirect policy for this call. */
  readonly redirect?: RedirectPolicy;
  /** How the call reads a 2xx answer; `json` when absent. */
  readonly responseKind?: ResponseKind;
  /** Text a `document` answer must contain, else the call fails. */
  readonly documentMarker?: string;
  /** Receives the declared headers of the final response; native transports only. */
  readonly headerSink?: IResponseHeaderSink;
}

/** How a transport reads one answered call: the bank's policy plus the call's own. */
interface IResponseReading {
  readonly statusPolicy: StatusPolicy;
  readonly responseKind: ResponseKind;
  readonly documentMarker?: string;
  readonly headerSink?: IResponseHeaderSink;
}

/** Fixed reason a transport reports for a refused redirect. */
const REDIRECT_REFUSED_REASON = 'redirect refused';

/** Fixed reason a transport reports for a document missing its marker. */
const DOCUMENT_UNVERIFIED_REASON = 'document unverified';

export type {
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
export { DOCUMENT_UNVERIFIED_REASON, REDIRECT_REFUSED_REASON };
