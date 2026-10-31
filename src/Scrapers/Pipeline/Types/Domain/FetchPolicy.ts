/**
 * Fetch policy — how one call treats a redirect (N2). A pure DTO leaf at
 * layer 5 so bank config (Registry), step config (Mediator), the per-call bus
 * options and the transports (Strategy) share one contract.
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

/** Per-call transport policy a step hands to the bus. */
interface IFetchCallPolicy {
  /** Overrides the bank's default redirect policy for this call. */
  readonly redirect?: RedirectPolicy;
}

export type { IFetchCallPolicy, IManualRedirect, IUrlRule, RedirectPolicy };
