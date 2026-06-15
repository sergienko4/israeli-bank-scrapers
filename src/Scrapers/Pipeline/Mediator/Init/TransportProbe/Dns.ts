/**
 * DNS phase of the transport probe — resolves the target hostname via
 * `dns.lookup` raced against a per-phase budget. On success carries the
 * lookup result forward; on failure builds a fully-tagged `dns-error`
 * probe envelope (the `DNS_LOOKUP_TIMEOUT` sentinel distinguishes a hung
 * resolver from a real NXDOMAIN).
 */

import * as dns from 'node:dns';

import { toError } from '../../../Types/ErrorUtils.js';
import rejectAndAck from './Reject.js';
import { buildProbeResult } from './Result.js';
import {
  EMPTY_ADDRESS,
  EMPTY_ENVELOPE,
  type IDnsLookupResult,
  type INavTransportProbe,
  type IProbeContext,
  type IProbeEnvelope,
  type ITransportProbeDeps,
  OUTCOME_OTHER_ERROR,
  ZERO_MS,
} from './Types.js';

/** Bundle passed to {@link onDnsLookupComplete} (`max-params: 3`). */
interface IDnsLookupCompleteInput {
  readonly start: number;
  readonly resolve: (value: IDnsLookupResult) => unknown;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Build the `dns.lookup` callback in the `(err, address, family)`
 * shape Node expects. Pulls Promise resolve/reject out of
 * {@link defaultDnsLookup} so the host stays ≤ 10 LoC.
 *
 * @param bundle - Start timestamp + Promise resolve/reject hooks.
 * @returns Node-style `dns.lookup` callback.
 */
function onDnsLookupComplete(bundle: IDnsLookupCompleteInput) {
  return (lookupError: unknown, address: string, family: number): boolean => {
    if (lookupError) return rejectAndAck(bundle.reject, lookupError);
    const dnsLookupMs = Date.now() - bundle.start;
    bundle.resolve({ address, family: family as 4 | 6, dnsLookupMs });
    return true;
  };
}

/**
 * Resolve a hostname via `dns.lookup`. Single-shot lookup (first
 * address only) — IPv4/IPv6 preference is delegated to the system.
 *
 * @param host - Hostname to resolve.
 * @returns Promise of address + family + timing.
 */
export function defaultDnsLookup(host: string): Promise<IDnsLookupResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const onComplete = onDnsLookupComplete({ start, resolve, reject });
    dns.lookup(host, { all: false }, onComplete);
  });
}

/**
 * Reject the DNS race when the per-phase budget fires before the
 * resolver answers. Encapsulates the `new Error` + `reject + ack`
 * pattern so the host {@link raceDnsAgainstBudget} fits ≤ 10 LoC.
 *
 * @param reject - Promise reject hook from {@link raceDnsAgainstBudget}.
 * @returns `true` (no-void rule).
 */
function dnsBudgetTimeout(reject: (e: Error) => unknown): boolean {
  const err = new Error('DNS_LOOKUP_TIMEOUT');
  return rejectAndAck(reject, err);
}

/**
 * Race a DNS lookup promise against a per-phase budget. Without this
 * race a hung resolver would keep `runDnsPhase` waiting forever and
 * silently break the {@link NODE_TRANSPORT_PROBE_BUDGET_MS} contract
 * promised by the snapshot. Resolves with the lookup result when DNS
 * answers first, rejects with `DNS_LOOKUP_TIMEOUT` when the budget
 * expires first.
 *
 * @param input - DNS-phase context + deps + per-phase budget.
 * @returns Promise of DNS result that always settles within `budgetMs`.
 */
function raceDnsAgainstBudget(input: IRunDnsInput): Promise<IDnsLookupResult> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout((): boolean => dnsBudgetTimeout(reject), input.budgetMs);
    input.deps.dnsLookup(input.context.url.host).then(
      (r: IDnsLookupResult): boolean => onDnsRaceResolved({ timer, lookupResult: r, resolve }),
      (error: unknown): boolean =>
        onDnsRaceRejected({ timer, lookupError: toError(error), reject }),
    );
  });
}

/** Bundle passed to {@link onDnsRaceResolved} (`max-params: 3`). */
interface IDnsRaceResolved {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly lookupResult: IDnsLookupResult;
  readonly resolve: (value: IDnsLookupResult) => unknown;
}

/**
 * Forward a successful DNS lookup to the race promise and clear the
 * budget timer so the rejection branch cannot fire afterwards.
 *
 * @param bundle - Timer + lookup result + resolve callback.
 * @returns `true` (no-void rule).
 */
function onDnsRaceResolved(bundle: IDnsRaceResolved): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.resolve(bundle.lookupResult);
  return true;
}

/** Bundle passed to {@link onDnsRaceRejected} (`max-params: 3`). */
interface IDnsRaceRejected {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly lookupError: Error;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Forward a DNS lookup error to the race promise and clear the budget
 * timer so the budget rejection cannot also fire.
 *
 * @param bundle - Timer + lookup error + reject callback.
 * @returns `true` (no-void rule).
 */
function onDnsRaceRejected(bundle: IDnsRaceRejected): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.reject(bundle.lookupError);
  return true;
}

/** Tagged result of the DNS phase. */
export interface IDnsPhaseOutcome {
  readonly isOk: boolean;
  readonly result: IDnsLookupResult;
  readonly probe: INavTransportProbe;
}

/** Bundle of inputs to {@link runDnsPhase} (`max-params: 3`). */
export interface IRunDnsInput {
  readonly context: IProbeContext;
  readonly deps: ITransportProbeDeps;
  readonly budgetMs: number;
}

/**
 * DNS phase: try to resolve the hostname within the per-phase budget.
 * On success returns an OK outcome carrying the lookup; on failure
 * returns a not-OK outcome carrying a fully-built `dns-error` probe
 * envelope. The `errorText` field carries the `DNS_LOOKUP_TIMEOUT`
 * sentinel when the budget fired before the resolver answered, so
 * operators can distinguish a real NXDOMAIN from a hung resolver.
 *
 * @param input - Context + deps + per-phase budget.
 * @returns Tagged outcome (success carries DNS result, failure carries probe).
 */
export async function runDnsPhase(input: IRunDnsInput): Promise<IDnsPhaseOutcome> {
  try {
    const result = await raceDnsAgainstBudget(input);
    return { isOk: true, result, probe: buildDnsErrorPlaceholder(input.context) };
  } catch (dnsError) {
    const probe = buildDnsFailureProbe(input.context, dnsError);
    return { isOk: false, result: buildDnsResultPlaceholder(), probe };
  }
}

/**
 * Build the failure-probe envelope for the DNS phase. Accepts the
 * caught value as `unknown` and normalizes it via {@link toError}
 * so the always-resolves contract holds even when the DNS dep
 * rejects with a non-Error value.
 *
 * @param context - Probe context (target/host metadata + timing baseline).
 * @param dnsError - Caught value from the rejected DNS lookup or budget timeout.
 * @returns Probe envelope tagged with the DNS-error outcome.
 */
function buildDnsFailureProbe(context: IProbeContext, dnsError: unknown): INavTransportProbe {
  const normalized = toError(dnsError);
  const envelope: IProbeEnvelope = { ...EMPTY_ENVELOPE, errorText: normalized.message };
  return buildProbeResult({ context, outcome: 'dns-error', envelope });
}

/**
 * Placeholder DNS result returned alongside a not-OK outcome (never read).
 *
 * @returns Synthetic DNS result with zero timing and an empty address.
 */
function buildDnsResultPlaceholder(): IDnsLookupResult {
  return { address: EMPTY_ADDRESS, family: 4, dnsLookupMs: ZERO_MS };
}

/**
 * Placeholder probe returned alongside an OK DNS outcome (never read).
 *
 * @param context - Probe context (target/host metadata + timing baseline).
 * @returns Synthetic probe shaped like an `other-error` failure; never inspected.
 */
function buildDnsErrorPlaceholder(context: IProbeContext): INavTransportProbe {
  return buildProbeResult({ context, outcome: OUTCOME_OTHER_ERROR, envelope: EMPTY_ENVELOPE });
}
