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
 */

import * as dns from 'node:dns';
import * as net from 'node:net';
import * as tls from 'node:tls';

/** Outcome of the post-failure transport probe (discriminated union). */
export type TransportProbeOutcome =
  | 'connected'
  | 'tcp-timeout'
  | 'tcp-refused'
  | 'tcp-reset'
  | 'tls-handshake-error'
  | 'tls-timeout'
  | 'dns-error'
  | 'other-error';

/** Probe result envelope. */
export interface INavTransportProbe {
  readonly host: string;
  readonly port: number;
  readonly outcome: TransportProbeOutcome;
  readonly dnsLookupMs: number;
  readonly tcpConnectMs: number;
  readonly tlsHandshakeMs: number;
  readonly resolvedAddress: string;
  readonly errorText: string;
  readonly timing: 'post-failure';
  readonly startedMsAfterGotoFailure: number;
  readonly totalBudgetMs: number;
}

/** DNS lookup result wrapper. */
export interface IDnsLookupResult {
  readonly address: string;
  readonly family: 4 | 6;
  readonly dnsLookupMs: number;
}

/** TCP handshake result wrapper (carries the open socket). */
export interface ITcpHandshakeResult {
  readonly tcpConnectMs: number;
  readonly socket: net.Socket;
}

/** Bundle of inputs to TCP-connect (`max-params: 3`). */
interface ITcpConnectInput {
  readonly host: string;
  readonly port: number;
  readonly budgetMs: number;
}

/** Bundle of inputs to TLS-upgrade (`max-params: 3`). */
interface ITlsUpgradeInput {
  readonly tcp: ITcpHandshakeResult;
  readonly servername: string;
  readonly budgetMs: number;
}

/** Dependency bundle injected for testability. */
export interface ITransportProbeDeps {
  readonly dnsLookup: (host: string) => Promise<IDnsLookupResult>;
  readonly tcpConnect: (input: ITcpConnectInput) => Promise<ITcpHandshakeResult>;
  readonly tlsUpgrade: (input: ITlsUpgradeInput) => Promise<number>;
}

/** Sentinel placeholder fields used when a phase did not run. */
const EMPTY_ADDRESS = '';
const ZERO_MS = 0;
/** Outcome used for placeholders and uncategorized errors. */
const OUTCOME_OTHER_ERROR: TransportProbeOutcome = 'other-error';

/**
 * Map a Node ErrnoException code to a probe outcome category. Pulled
 * out so the TCP-phase handler stays small and the mapping table is
 * a single audit point.
 *
 * @param code - The `code` field of a NodeJS.ErrnoException.
 * @returns Outcome to assign when this code is the failure cause.
 */
function categorizeTcpError(code: string): TransportProbeOutcome {
  if (code === 'ECONNREFUSED') return 'tcp-refused';
  if (code === 'ECONNRESET') return 'tcp-reset';
  if (code === 'ETIMEDOUT') return 'tcp-timeout';
  return OUTCOME_OTHER_ERROR;
}

/** URL parts the probe needs to pick TCP-vs-TLS path and port. */
interface IUrlParts {
  readonly host: string;
  readonly port: number;
  readonly isTls: boolean;
}

/**
 * Default port for the resolved scheme — split out so the parser
 * does not use nested ternary expressions (forbidden by lint).
 *
 * @param isTls - True for `https:`.
 * @returns 443 when TLS, 80 otherwise.
 */
function defaultPortForScheme(isTls: boolean): number {
  if (isTls) return 443;
  return 80;
}

/**
 * Parse the target URL into the parts the probe needs. Uses
 * the WHATWG URL constructor so encoded hosts are handled correctly.
 *
 * @param targetUrl - URL string (must include scheme).
 * @returns Hostname, port (explicit or scheme default), and TLS flag.
 */
function parseTargetUrl(targetUrl: string): IUrlParts {
  const parsed = new URL(targetUrl);
  const isTls = parsed.protocol === 'https:';
  const explicitPort = parsed.port;
  const port = explicitPort ? Number(explicitPort) : defaultPortForScheme(isTls);
  return { host: parsed.hostname, port, isTls };
}

/**
 * Resolve a hostname via `dns.lookup`. Single-shot lookup (first
 * address only) — IPv4/IPv6 preference is delegated to the system.
 *
 * @param host - Hostname to resolve.
 * @returns Promise of address + family + timing.
 */
function defaultDnsLookup(host: string): Promise<IDnsLookupResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    dns.lookup(host, { all: false }, (lookupError, address, family) => {
      if (lookupError) {
        reject(lookupError);
      } else {
        const dnsLookupMs = Date.now() - start;
        resolve({ address, family: family as 4 | 6, dnsLookupMs });
      }
    });
  });
}

/**
 * Build the timeout handler that destroys the socket after the
 * budget elapses. Extracted to keep {@link defaultTcpConnect} short.
 *
 * @param socket - Socket to destroy on timeout.
 * @returns Handler returning `true` (no-void rule).
 */
function makeTcpTimeoutHandler(socket: net.Socket): () => boolean {
  return (): boolean => {
    socket.destroy(new Error('TCP_CONNECT_TIMEOUT'));
    return true;
  };
}

/**
 * Open a TCP socket to (host, port) within the budget, returning
 * timing + the connected socket. The socket is left OPEN for the
 * caller (TLS upgrade or test inspection) — caller MUST destroy.
 *
 * @param input - Host + port + wall-clock budget.
 * @returns Promise of timing + socket (resolves on `connect`).
 */
function defaultTcpConnect(input: ITcpConnectInput): Promise<ITcpHandshakeResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = net.connect({ host: input.host, port: input.port });
    const onTimeout = makeTcpTimeoutHandler(socket);
    const timer = globalThis.setTimeout(onTimeout, input.budgetMs);
    socket.once('connect', (): boolean => {
      globalThis.clearTimeout(timer);
      resolve({ tcpConnectMs: Date.now() - start, socket });
      return true;
    });
    socket.once('error', (socketError: Error): boolean => {
      globalThis.clearTimeout(timer);
      socket.destroy();
      reject(socketError);
      return true;
    });
  });
}

/**
 * Build the timeout handler that destroys the TLS socket after the
 * budget elapses. Extracted to keep {@link defaultTlsUpgrade} short.
 *
 * @param tlsSocket - TLS socket to destroy on timeout.
 * @returns Handler returning `true` (no-void rule).
 */
function makeTlsTimeoutHandler(tlsSocket: tls.TLSSocket): () => boolean {
  return (): boolean => {
    tlsSocket.destroy(new Error('TLS_HANDSHAKE_TIMEOUT'));
    return true;
  };
}

/**
 * Upgrade an open TCP socket to TLS, returning handshake timing in
 * ms. Destroys the TLS socket on resolution to free the underlying
 * TCP socket — the probe does not need to read any data.
 *
 * @param input - Open TCP handshake + SNI servername + budget.
 * @returns Promise of handshake duration in ms (resolves on `secureConnect`).
 */
function defaultTlsUpgrade(input: ITlsUpgradeInput): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tlsSocket = tls.connect({ socket: input.tcp.socket, servername: input.servername });
    const onTimeout = makeTlsTimeoutHandler(tlsSocket);
    const timer = globalThis.setTimeout(onTimeout, input.budgetMs);
    tlsSocket.once('secureConnect', (): boolean => {
      globalThis.clearTimeout(timer);
      tlsSocket.destroy();
      resolve(Date.now() - start);
      return true;
    });
    tlsSocket.once('error', (tlsError: Error): boolean => {
      globalThis.clearTimeout(timer);
      tlsSocket.destroy();
      reject(tlsError);
      return true;
    });
  });
}

/** Production deps bundle — wires the real Node modules. */
const DEFAULT_TRANSPORT_DEPS: ITransportProbeDeps = {
  dnsLookup: defaultDnsLookup,
  tcpConnect: defaultTcpConnect,
  tlsUpgrade: defaultTlsUpgrade,
};

/** Bundle of inputs to {@link probeTransportWithDeps} (`max-params: 3`). */
export interface IProbeRunInput {
  readonly targetUrl: string;
  readonly totalBudgetMs: number;
  readonly startedMsAfterGotoFailure: number;
}

/** Internal probe context built once from {@link IProbeRunInput}. */
interface IProbeContext {
  readonly url: IUrlParts;
  readonly run: IProbeRunInput;
}

/** Bundle of fields shared by every probe outcome (success or fail). */
interface IProbeEnvelope {
  readonly dnsLookupMs: number;
  readonly tcpConnectMs: number;
  readonly tlsHandshakeMs: number;
  readonly resolvedAddress: string;
  readonly errorText: string;
}

/** Sensible defaults for every envelope field. */
const EMPTY_ENVELOPE: IProbeEnvelope = {
  dnsLookupMs: ZERO_MS,
  tcpConnectMs: ZERO_MS,
  tlsHandshakeMs: ZERO_MS,
  resolvedAddress: EMPTY_ADDRESS,
  errorText: '',
};

/** Bundle of inputs to {@link buildProbeResult} (`max-params: 3`). */
interface IBuildProbeInput {
  readonly context: IProbeContext;
  readonly outcome: TransportProbeOutcome;
  readonly envelope: IProbeEnvelope;
}

/**
 * Build the final probe result envelope from the discriminated
 * outcome + collected envelope fields. Pure constructor; no I/O.
 *
 * @param input - Context + outcome + envelope (all timing + IP fields).
 * @returns The probe envelope written to the snapshot.
 */
function buildProbeResult(input: IBuildProbeInput): INavTransportProbe {
  return {
    host: input.context.url.host,
    port: input.context.url.port,
    outcome: input.outcome,
    dnsLookupMs: input.envelope.dnsLookupMs,
    tcpConnectMs: input.envelope.tcpConnectMs,
    tlsHandshakeMs: input.envelope.tlsHandshakeMs,
    resolvedAddress: input.envelope.resolvedAddress,
    errorText: input.envelope.errorText,
    timing: 'post-failure',
    startedMsAfterGotoFailure: input.context.run.startedMsAfterGotoFailure,
    totalBudgetMs: input.context.run.totalBudgetMs,
  };
}

/** Tagged result of the DNS phase. */
interface IDnsPhaseOutcome {
  readonly isOk: boolean;
  readonly result: IDnsLookupResult;
  readonly probe: INavTransportProbe;
}

/** Bundle of inputs to {@link runDnsPhase} (`max-params: 3`). */
interface IRunDnsInput {
  readonly context: IProbeContext;
  readonly deps: ITransportProbeDeps;
}

/**
 * DNS phase: try to resolve the hostname. On success returns an OK
 * outcome carrying the lookup; on failure returns a not-OK outcome
 * carrying a fully-built `dns-error` probe envelope.
 *
 * @param input - Context + deps bundle.
 * @returns Tagged outcome (success carries DNS result, failure carries probe).
 */
async function runDnsPhase(input: IRunDnsInput): Promise<IDnsPhaseOutcome> {
  try {
    const result = await input.deps.dnsLookup(input.context.url.host);
    return { isOk: true, result, probe: buildDnsErrorPlaceholder(input.context) };
  } catch (dnsError) {
    const errorText = (dnsError as Error).message;
    const envelope: IProbeEnvelope = { ...EMPTY_ENVELOPE, errorText };
    const probe = buildProbeResult({
      context: input.context,
      outcome: 'dns-error',
      envelope,
    });
    return { isOk: false, result: buildDnsResultPlaceholder(), probe };
  }
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

/** Tagged result of the TCP phase. */
interface ITcpPhaseOutcome {
  readonly isOk: boolean;
  readonly handshake: ITcpHandshakeResult;
  readonly probe: INavTransportProbe;
}

/** Bundle of inputs to {@link runTcpPhase} (`max-params: 3`). */
interface IRunTcpInput {
  readonly context: IProbeContext;
  readonly deps: ITransportProbeDeps;
  readonly dns: IDnsLookupResult;
  readonly budgetMs: number;
}

/**
 * Decide which TCP-phase outcome to assign based on the error
 * payload. Looks for the `TCP_CONNECT_TIMEOUT` sentinel first, then
 * falls through to {@link categorizeTcpError}.
 *
 * @param tcpError - Error object from the rejected tcp-connect.
 * @returns Outcome to assign for the failed-probe envelope.
 */
function tcpFailureOutcome(tcpError: Error): TransportProbeOutcome {
  if (tcpError.message.includes('TCP_CONNECT_TIMEOUT')) return 'tcp-timeout';
  const errno = tcpError as NodeJS.ErrnoException;
  const code = errno.code ?? '';
  return categorizeTcpError(code);
}

/**
 * TCP phase: connect to the resolved address. On success returns an
 * OK outcome carrying the handshake (socket left open); on failure
 * returns a not-OK outcome carrying a fully-built probe envelope.
 *
 * @param input - Context + deps + DNS result + per-phase budget.
 * @returns Tagged outcome (success carries TCP handshake, failure carries probe).
 */
async function runTcpPhase(input: IRunTcpInput): Promise<ITcpPhaseOutcome> {
  try {
    const handshake = await input.deps.tcpConnect({
      host: input.dns.address,
      port: input.context.url.port,
      budgetMs: input.budgetMs,
    });
    return { isOk: true, handshake, probe: buildHandshakePlaceholder(input.context) };
  } catch (tcpError) {
    return {
      isOk: false,
      handshake: buildHandshakePlaceholder2(),
      probe: buildTcpFailureProbe(input, tcpError as Error),
    };
  }
}

/**
 * Build the failure-probe envelope for the TCP phase.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @param tcpError - Error object from the rejected tcp-connect.
 * @returns Probe envelope tagged with the categorized TCP outcome.
 */
function buildTcpFailureProbe(input: IRunTcpInput, tcpError: Error): INavTransportProbe {
  const envelope: IProbeEnvelope = {
    ...EMPTY_ENVELOPE,
    dnsLookupMs: input.dns.dnsLookupMs,
    resolvedAddress: input.dns.address,
    errorText: tcpError.message,
  };
  return buildProbeResult({
    context: input.context,
    outcome: tcpFailureOutcome(tcpError),
    envelope,
  });
}

/**
 * Placeholder probe returned alongside an OK TCP outcome (never read).
 *
 * @param context - Probe context (target/host metadata + timing baseline).
 * @returns Synthetic probe shaped like an `other-error` failure; never inspected.
 */
function buildHandshakePlaceholder(context: IProbeContext): INavTransportProbe {
  return buildProbeResult({ context, outcome: OUTCOME_OTHER_ERROR, envelope: EMPTY_ENVELOPE });
}

/**
 * Placeholder handshake returned alongside a not-OK outcome (never read).
 *
 * @returns Synthetic TCP handshake with zero timing and an unconnected socket.
 */
function buildHandshakePlaceholder2(): ITcpHandshakeResult {
  return { tcpConnectMs: ZERO_MS, socket: new net.Socket() };
}

/** Bundle of inputs to {@link runTlsPhase} (`max-params: 3`). */
interface IRunTlsInput {
  readonly context: IProbeContext;
  readonly deps: ITransportProbeDeps;
  readonly dns: IDnsLookupResult;
  readonly tcp: ITcpHandshakeResult;
  readonly budgetMs: number;
}

/**
 * Decide which TLS-phase outcome to assign based on the error
 * payload. Looks for the `TLS_HANDSHAKE_TIMEOUT` sentinel.
 *
 * @param tlsError - Error object from the rejected tls-upgrade.
 * @returns Outcome to assign for the failed-probe envelope.
 */
function tlsFailureOutcome(tlsError: Error): TransportProbeOutcome {
  if (tlsError.message.includes('TLS_HANDSHAKE_TIMEOUT')) return 'tls-timeout';
  return 'tls-handshake-error';
}

/**
 * Build the success-path probe envelope (post-TCP / post-TLS).
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @param tlsMs - Measured TLS handshake duration in milliseconds (0 for plain HTTP).
 * @returns Probe envelope tagged with the `connected` outcome.
 */
function buildSuccessProbe(input: IRunTlsInput, tlsMs: number): INavTransportProbe {
  const envelope: IProbeEnvelope = {
    dnsLookupMs: input.dns.dnsLookupMs,
    tcpConnectMs: input.tcp.tcpConnectMs,
    tlsHandshakeMs: tlsMs,
    resolvedAddress: input.dns.address,
    errorText: '',
  };
  return buildProbeResult({ context: input.context, outcome: 'connected', envelope });
}

/**
 * Build the failure-path probe envelope for the TLS phase.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @param tlsError - Error object from the rejected tls-upgrade.
 * @returns Probe envelope tagged with the categorized TLS outcome.
 */
function buildTlsFailureProbe(input: IRunTlsInput, tlsError: Error): INavTransportProbe {
  const envelope: IProbeEnvelope = {
    dnsLookupMs: input.dns.dnsLookupMs,
    tcpConnectMs: input.tcp.tcpConnectMs,
    tlsHandshakeMs: ZERO_MS,
    resolvedAddress: input.dns.address,
    errorText: tlsError.message,
  };
  return buildProbeResult({
    context: input.context,
    outcome: tlsFailureOutcome(tlsError),
    envelope,
  });
}

/**
 * TLS phase: optional handshake when isTls, else destroy the TCP
 * socket and return a `'connected'` envelope. Always builds a probe
 * envelope — this is the terminal phase of the probe.
 *
 * @param input - Context + deps + DNS + open TCP + per-phase budget.
 * @returns The final probe envelope.
 */
async function runTlsPhase(input: IRunTlsInput): Promise<INavTransportProbe> {
  if (!input.context.url.isTls) {
    input.tcp.socket.destroy();
    return buildSuccessProbe(input, ZERO_MS);
  }
  try {
    const tlsMs = await input.deps.tlsUpgrade({
      tcp: input.tcp,
      servername: input.context.url.host,
      budgetMs: input.budgetMs,
    });
    return buildSuccessProbe(input, tlsMs);
  } catch (tlsError) {
    input.tcp.socket.destroy();
    return buildTlsFailureProbe(input, tlsError as Error);
  }
}

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

/** Bundle of inputs to {@link probeTransportWithDeps} (`max-params: 3`). */
export interface IProbeTransportInput {
  readonly run: IProbeRunInput;
  readonly deps: ITransportProbeDeps;
}

/**
 * Test-injectable probe — runs DNS → TCP → TLS with a hard wall-clock
 * budget split across the three phases. Each phase reports its own
 * timing; the first failing phase short-circuits and returns the
 * partial timing it collected so the operator can see how far the
 * probe got. Always resolves; never throws.
 *
 * @param input - Probe run inputs + dependency bundle.
 * @returns The probe envelope.
 */
export async function probeTransportWithDeps(
  input: IProbeTransportInput,
): Promise<INavTransportProbe> {
  const url = parseTargetUrl(input.run.targetUrl);
  const context: IProbeContext = { url, run: input.run };
  const dnsPhase = await runDnsPhase({ context, deps: input.deps });
  if (!dnsPhase.isOk) return dnsPhase.probe;
  const budgetMs = phaseBudget(input.run.totalBudgetMs);
  const tcpPhase = await runTcpPhase({ context, deps: input.deps, dns: dnsPhase.result, budgetMs });
  if (!tcpPhase.isOk) return tcpPhase.probe;
  return runTlsPhase({
    context,
    deps: input.deps,
    dns: dnsPhase.result,
    tcp: tcpPhase.handshake,
    budgetMs,
  });
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
