/**
 * Node-level transport probe — runs `dns.lookup` + `tls.connect` (or
 * `net.connect` for plain HTTP) AFTER a navigation failure to capture
 * L4 evidence the browser does not surface. Helps disambiguate the
 * `category: 'timeout', failedRequests: []` fingerprint that bare
 * Playwright timeouts produce.
 *
 * <p>**MUST CAVEAT** — this probe runs from the Node.js parent
 * process, NOT from inside the Camoufox child process. Node and
 * Camoufox differ in DNS resolver path, IPv4/IPv6 preference, TLS
 * fingerprint, ALPN, SNI handling, and proxy/env handling. A
 * successful Node probe does NOT prove Camoufox can connect, and a
 * failing Node probe does NOT prove Camoufox cannot connect — it
 * only adds corroborating evidence from a different vantage point.
 * The {@link INavFailureSnapshot} field that carries this probe is
 * named `nodeTransportProbe` (not `transportProbe`) for exactly this
 * reason — to push the caveat into the field name.
 *
 * <p>This probe also runs AFTER the navigation failure, so its
 * observed state may differ from the state that caused the failure
 * (e.g., Radware may have rate-limited the runner during the
 * 15-second goto attempt, so the probe sees a worse outcome than
 * the actual failure). The snapshot field `startedMsAfterGotoFailure`
 * records the delay so the operator can reason about this.
 *
 * <p>Lifecycle invariants:
 *   - Every code path clears every timer (the budget timeout).
 *   - Every code path destroys every socket (TCP + TLS).
 *   - The returned promise resolves exactly once — never throws.
 *   - Outcome `'other-error'` carries the original `errorText` so the
 *     operator can investigate even when the discriminated union
 *     doesn't cover the failure mode.
 *
 * <p>This orchestrator wires the per-phase modules (Url / Dns / Tcp /
 * Tls / Result) together; the phase implementations live in sibling
 * files under `./` and are surfaced to callers via the
 * `NavigationTransportProbe` facade.
 */

import { defaultDnsLookup, type IRunDnsInput, runDnsPhase } from './Dns.js';
import { buildProbeResult } from './Result.js';
import { defaultTcpConnect, type IRunTcpInput, runTcpPhase } from './Tcp.js';
import { defaultTlsUpgrade, type IRunTlsInput, runTlsPhase } from './Tls.js';
import {
  EMPTY_ENVELOPE,
  EMPTY_URL,
  type INavTransportProbe,
  type IProbeContext,
  type IProbeEnvelope,
  type IProbeRunInput,
  type IProbeTransportInput,
  type ITransportProbeDeps,
  OUTCOME_OTHER_ERROR,
} from './Types.js';
import { tryParseTargetUrl } from './Url.js';

/** Production deps bundle — wires the real Node modules. */
const DEFAULT_TRANSPORT_DEPS: ITransportProbeDeps = {
  dnsLookup: defaultDnsLookup,
  tcpConnect: defaultTcpConnect,
  tlsUpgrade: defaultTlsUpgrade,
};

/**
 * Compute per-phase budget — DNS/TCP/TLS each get a third of the
 * total budget, with a 500 ms minimum floor so tiny budgets still
 * give each phase a chance to complete.
 *
 * @param totalBudgetMs - Total wall-clock budget in ms.
 * @returns Per-phase budget in ms.
 */
function phaseBudget(totalBudgetMs: number): number {
  const third = Math.floor(totalBudgetMs / 3);
  return Math.max(500, third);
}

/**
 * Build a synthetic `other-error` probe used when {@link tryParseTargetUrl}
 * rejects the URL. The envelope carries the parse error in `errorText`
 * so operators can diagnose malformed URL inputs without losing the
 * always-resolves contract.
 *
 * @param run - Probe run inputs (used for `startedMsAfterGotoFailure` + budget).
 * @param errorText - Message from the `new URL(...)` exception.
 * @returns Probe envelope tagged `other-error` with empty timing fields.
 */
function buildUrlParseFailureProbe(run: IProbeRunInput, errorText: string): INavTransportProbe {
  const context: IProbeContext = { url: EMPTY_URL, run };
  const envelope: IProbeEnvelope = { ...EMPTY_ENVELOPE, errorText };
  return buildProbeResult({ context, outcome: OUTCOME_OTHER_ERROR, envelope });
}

/**
 * Run DNS → TCP → TLS in sequence. The first phase to fail
 * short-circuits and returns the partial probe envelope it built.
 * Extracted from {@link probeTransportWithDeps} so that entry point
 * fits the 10-LoC cap.
 *
 * @param phases - Probe context + deps + per-phase budget (shared by all 3 phases).
 * @returns Probe envelope from the first failing phase, or the TLS phase result.
 */
async function runDnsTcpTlsPhases(phases: IRunDnsInput): Promise<INavTransportProbe> {
  const dnsPhase = await runDnsPhase(phases);
  if (!dnsPhase.isOk) return dnsPhase.probe;
  const tcpInput: IRunTcpInput = { ...phases, dns: dnsPhase.result };
  const tcpPhase = await runTcpPhase(tcpInput);
  if (!tcpPhase.isOk) return tcpPhase.probe;
  const tlsInput: IRunTlsInput = { ...phases, dns: dnsPhase.result, tcp: tcpPhase.handshake };
  return runTlsPhase(tlsInput);
}

/**
 * Test-injectable probe — runs DNS → TCP → TLS with a hard wall-clock
 * budget split across the three phases. Each phase reports its own
 * timing; the first failing phase short-circuits and returns the
 * partial timing it collected so the operator can see how far the
 * probe got. Always resolves; never throws — even malformed URLs map
 * to an `other-error` probe instead of a thrown exception.
 *
 * @param input - Probe run inputs + dependency bundle.
 * @returns The probe envelope.
 */
export async function probeTransportWithDeps(
  input: IProbeTransportInput,
): Promise<INavTransportProbe> {
  const parsed = tryParseTargetUrl(input.run.targetUrl);
  if (!parsed.isOk) return buildUrlParseFailureProbe(input.run, parsed.errorText);
  const context: IProbeContext = { url: parsed.url, run: input.run };
  const budgetMs = phaseBudget(input.run.totalBudgetMs);
  return runDnsTcpTlsPhases({ context, deps: input.deps, budgetMs });
}

/**
 * Run the transport probe with real DNS/TCP/TLS deps. Thin wrapper
 * around {@link probeTransportWithDeps} so production code has a
 * dependency-free entry point and tests can use the deps overload.
 *
 * @param run - Probe run inputs (url + budget + delay).
 * @returns The probe envelope.
 */
export function probeTransport(run: IProbeRunInput): Promise<INavTransportProbe> {
  return probeTransportWithDeps({ run, deps: DEFAULT_TRANSPORT_DEPS });
}
