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

import { toError } from '../../Types/ErrorUtils.js';

/** IPv4 address family marker (used as `family` value in DNS results). */
const IPV4 = 4;

/** Default TCP port for HTTPS scheme. */
const HTTPS_DEFAULT_PORT = 443;
/** Default TCP port for plain HTTP scheme. */
const HTTP_DEFAULT_PORT = 80;

/** Per-phase budget split — DNS, TCP, and TLS each receive 1/N of the total budget. */
const BUDGET_PHASES = 3;
/** Floor (ms) below which a per-phase budget cannot fall, so tiny totals still progress. */
const MIN_PHASE_BUDGET_MS = 500;

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
  readonly family: number;
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
  if (isTls) return HTTPS_DEFAULT_PORT;
  return HTTP_DEFAULT_PORT;
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
    bundle.resolve({ address, family, dnsLookupMs });
    return true;
  };
}

/**
 * Forward a caught error (typed as `unknown`) to a Promise reject hook
 * and acknowledge the listener. Normalizes `err` into a real `Error`
 * via {@link toError} so the always-resolves; never-throws contract
 * holds even when a dep rejects with a non-Error value (string, plain
 * object, etc.). Saves a 2-line `if`/`return` block in callbacks
 * bumping against the 10-LoC cap.
 *
 * @param reject - Promise reject hook.
 * @param err - Caught value to normalize and propagate.
 * @returns `true` (no-void rule).
 */
function rejectAndAck(reject: (e: Error) => unknown, err: unknown): boolean {
  const normalized = toError(err);
  reject(normalized);
  return true;
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

/** Bundle passed to {@link onTcpConnect} (`max-params: 3`). */
interface ITcpConnectBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly socket: net.Socket;
  readonly start: number;
  readonly resolve: (value: ITcpHandshakeResult) => unknown;
}

/**
 * Handle the TCP `connect` event — clear the budget timer and
 * resolve with the open socket + timing.
 *
 * @param bundle - Timer + socket + start timestamp + resolve hook.
 * @returns `true` (no-void rule).
 */
function onTcpConnect(bundle: ITcpConnectBundle): boolean {
  globalThis.clearTimeout(bundle.timer);
  const tcpConnectMs = Date.now() - bundle.start;
  bundle.resolve({ tcpConnectMs, socket: bundle.socket });
  return true;
}

/** Bundle passed to {@link onTcpError} (`max-params: 3`). */
interface ITcpErrorBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly socket: net.Socket;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Handle the TCP `error` event — clear the budget timer, destroy
 * the socket, and reject the probe Promise.
 *
 * @param bundle - Timer + socket + reject hook.
 * @param socketError - Error emitted by the socket.
 * @returns `true` (no-void rule).
 */
function onTcpError(bundle: ITcpErrorBundle, socketError: Error): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.socket.destroy();
  return rejectAndAck(bundle.reject, socketError);
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
    socket.once('connect', (): boolean => onTcpConnect({ timer, socket, start, resolve }));
    socket.once('error', (e: Error): boolean => onTcpError({ timer, socket, reject }, e));
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

/** Bundle passed to {@link onTlsSecureConnect} (`max-params: 3`). */
interface ITlsSecureConnectBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly tlsSocket: tls.TLSSocket;
  readonly start: number;
  readonly resolve: (value: number) => unknown;
}

/**
 * Handle the TLS `secureConnect` event — clear the timer, destroy
 * the TLS socket (probe is observation-only), and resolve with the
 * handshake duration.
 *
 * @param bundle - Timer + TLS socket + start timestamp + resolve hook.
 * @returns `true` (no-void rule).
 */
function onTlsSecureConnect(bundle: ITlsSecureConnectBundle): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.tlsSocket.destroy();
  bundle.resolve(Date.now() - bundle.start);
  return true;
}

/** Bundle passed to {@link onTlsError} (`max-params: 3`). */
interface ITlsErrorBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly tlsSocket: tls.TLSSocket;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Handle the TLS `error` event — clear the timer, destroy the TLS
 * socket, and reject the probe Promise.
 *
 * @param bundle - Timer + TLS socket + reject hook.
 * @param tlsError - Error emitted by the TLS socket.
 * @returns `true` (no-void rule).
 */
function onTlsError(bundle: ITlsErrorBundle, tlsError: Error): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.tlsSocket.destroy();
  return rejectAndAck(bundle.reject, tlsError);
}

/**
 * Bundle passed to {@link attachTlsHandlers} (`max-params: 3`).
 * Carries everything both the success and error paths need.
 */
interface ITlsHandlersInput {
  readonly tlsSocket: tls.TLSSocket;
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly start: number;
  readonly resolve: (value: number) => unknown;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Wire both `secureConnect` and `error` once-listeners onto the TLS
 * socket. Extracted so {@link defaultTlsUpgrade} stays ≤10 LoC and
 * the two listener arrows remain ≤100 chars each.
 *
 * @param input - TLS socket + timer + Promise hooks.
 * @returns `true` (no-void rule).
 */
function attachTlsHandlers(input: ITlsHandlersInput): boolean {
  const { tlsSocket, timer, start, resolve, reject } = input;
  /**
   * Wire TLS `secureConnect` → resolve probe Promise with timing.
   *
   * @returns `true` (no-void rule).
   */
  const onOk = (): boolean => onTlsSecureConnect({ timer, tlsSocket, start, resolve });
  /**
   * Wire TLS `error` → reject probe Promise with the underlying error.
   *
   * @param error - Error emitted by the TLS socket.
   * @returns `true` (no-void rule).
   */
  const onErr = (error: Error): boolean => onTlsError({ timer, tlsSocket, reject }, error);
  tlsSocket.once('secureConnect', onOk);
  tlsSocket.once('error', onErr);
  return true;
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
    attachTlsHandlers({ tlsSocket, timer, start, resolve, reject });
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

/** Trailing timing / budget fields shared by every probe envelope. */
interface IProbeTimingFields {
  readonly timing: 'post-failure';
  readonly startedMsAfterGotoFailure: number;
  readonly totalBudgetMs: number;
}

/**
 * Build the trailing timing / budget fields shared by every probe
 * envelope. Pulled out so {@link buildProbeResult} fits ≤ 10 LoC.
 *
 * @param run - Probe run inputs (carries timing baseline + total budget).
 * @returns Object literal with `timing`, `startedMsAfterGotoFailure`, `totalBudgetMs`.
 */
function buildTimingFields(run: IProbeRunInput): IProbeTimingFields {
  return {
    timing: 'post-failure',
    startedMsAfterGotoFailure: run.startedMsAfterGotoFailure,
    totalBudgetMs: run.totalBudgetMs,
  };
}

/**
 * Build the final probe result envelope from the discriminated
 * outcome + collected envelope fields. Pure constructor; no I/O.
 *
 * @param input - Context + outcome + envelope (all timing + IP fields).
 * @returns The probe envelope written to the snapshot.
 */
function buildProbeResult(input: IBuildProbeInput): INavTransportProbe {
  const { url, run } = input.context;
  return {
    host: url.host,
    port: url.port,
    outcome: input.outcome,
    ...input.envelope,
    ...buildTimingFields(run),
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
async function runDnsPhase(input: IRunDnsInput): Promise<IDnsPhaseOutcome> {
  try {
    const result = await raceDnsAgainstBudget(input);
    return { isOk: true, result, probe: buildDnsErrorPlaceholder(input.context) };
  } catch (dnsError) {
    const probe = buildDnsFailureProbe(input.context, dnsError);
    return { isOk: false, result: buildDnsResultPlaceholder(), probe };
  }
}

/**
 * Build the failure-probe envelope for the DNS phase.
 *
 * @param context - Probe context (target/host metadata + timing baseline).
 * @param dnsError - Error object from the rejected DNS lookup or budget timeout.
 * @returns Probe envelope tagged with the `dns-error` outcome.
 */
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
  return { address: EMPTY_ADDRESS, family: IPV4, dnsLookupMs: ZERO_MS };
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
 * Build a TCP-phase outcome tagged as failed. Wraps the standard
 * placeholder handshake + failure probe pair so {@link runTcpPhase}'s
 * catch branch fits on a single line.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @param tcpError - Error from the rejected tcp-connect.
 * @returns Tagged not-OK TCP outcome with the categorized probe envelope.
 */
/**
 * Wrap a {@link buildTcpFailureProbe} call in a tagged failure outcome.
 * Accepts the caught value as `unknown` and normalizes via the
 * downstream probe builder so the always-resolves contract holds
 * even when `tcpConnect` rejects with a non-Error value.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @param tcpError - Caught value from the rejected tcp-connect.
 * @returns Tagged not-OK TCP outcome with the categorized probe envelope.
 */
function buildTcpFailureOutcome(input: IRunTcpInput, tcpError: unknown): ITcpPhaseOutcome {
  return {
    isOk: false,
    handshake: buildHandshakePlaceholder2(),
    probe: buildTcpFailureProbe(input, tcpError),
  };
}

/**
 * Build the {@link ITcpConnectInput} from the TCP-phase bundle. Pure
 * field mapping; pulled out so {@link runTcpPhase} avoids a nested
 * call (forbidden by lint) when calling `deps.tcpConnect`.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @returns The host / port / budget bundle the connector expects.
 */
function makeTcpConnectInput(input: IRunTcpInput): ITcpConnectInput {
  return { host: input.dns.address, port: input.context.url.port, budgetMs: input.budgetMs };
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
  const tcpInput = makeTcpConnectInput(input);
  try {
    const handshake = await input.deps.tcpConnect(tcpInput);
    return { isOk: true, handshake, probe: buildHandshakePlaceholder(input.context) };
  } catch (tcpError) {
    return buildTcpFailureOutcome(input, tcpError);
  }
}

/**
 * Build the TCP-failure envelope (DNS timing carried forward, TCP/TLS
 * fields left empty, error message carried in `errorText`).
 *
 * @param dns - DNS phase result (address + lookup timing).
 * @param message - Error message from the rejected tcp-connect.
 * @returns Envelope sized for the failed-probe path.
 */
function makeTcpFailureEnvelope(dns: IDnsLookupResult, message: string): IProbeEnvelope {
  return {
    ...EMPTY_ENVELOPE,
    dnsLookupMs: dns.dnsLookupMs,
    resolvedAddress: dns.address,
    errorText: message,
  };
}

/**
 * Build the failure-probe envelope for the TCP phase.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @param tcpError - Error object from the rejected tcp-connect.
 * @returns Probe envelope tagged with the categorized TCP outcome.
 */
/**
 * Build the failure-probe envelope for the TCP phase. Accepts the
 * caught value as `unknown` and normalizes via {@link toError} so
 * `tcpFailureOutcome` and `makeTcpFailureEnvelope` see a real Error
 * even when the dep rejects with a non-Error value.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @param tcpError - Caught value from the rejected tcp-connect.
 * @returns Probe envelope tagged with the categorized TCP outcome.
 */
function buildTcpFailureProbe(input: IRunTcpInput, tcpError: unknown): INavTransportProbe {
  const normalized = toError(tcpError);
  const envelope = makeTcpFailureEnvelope(input.dns, normalized.message);
  const outcome = tcpFailureOutcome(normalized);
  return buildProbeResult({ context: input.context, outcome, envelope });
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

/** Bundle of inputs to {@link makeTlsFailureEnvelope} (`max-params: 3`). */
interface ITlsFailureEnvInput {
  readonly dns: IDnsLookupResult;
  readonly tcp: ITcpHandshakeResult;
  readonly message: string;
}

/**
 * Build the TLS-failure envelope (DNS + TCP timings carried forward,
 * TLS reset to zero, error message carried in `errorText`).
 *
 * @param input - DNS result + TCP result + error message.
 * @returns Envelope sized for the failed-probe path.
 */
function makeTlsFailureEnvelope(input: ITlsFailureEnvInput): IProbeEnvelope {
  return {
    dnsLookupMs: input.dns.dnsLookupMs,
    tcpConnectMs: input.tcp.tcpConnectMs,
    tlsHandshakeMs: ZERO_MS,
    resolvedAddress: input.dns.address,
    errorText: input.message,
  };
}

/**
 * Build the failure-path probe envelope for the TLS phase.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @param tlsError - Error object from the rejected tls-upgrade.
 * @returns Probe envelope tagged with the categorized TLS outcome.
 */
/**
 * Build the failure-path probe envelope for the TLS phase. Accepts
 * the caught value as `unknown` and normalizes via {@link toError}
 * so `tlsFailureOutcome` and `makeTlsFailureEnvelope` see a real
 * Error even when the dep rejects with a non-Error value.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @param tlsError - Caught value from the rejected tls-upgrade.
 * @returns Probe envelope tagged with the categorized TLS outcome.
 */
function buildTlsFailureProbe(input: IRunTlsInput, tlsError: unknown): INavTransportProbe {
  const { dns, tcp } = input;
  const normalized = toError(tlsError);
  const envelope = makeTlsFailureEnvelope({ dns, tcp, message: normalized.message });
  const outcome = tlsFailureOutcome(normalized);
  return buildProbeResult({ context: input.context, outcome, envelope });
}

/**
 * Build the {@link ITlsUpgradeInput} from the TLS-phase bundle. Pure
 * field mapping; pulled out so {@link runTlsPhase}'s try-branch fits
 * the 10-LoC cap.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @returns The tcp / servername / budget bundle the upgrader expects.
 */
function makeTlsUpgradeInput(input: IRunTlsInput): ITlsUpgradeInput {
  return { tcp: input.tcp, servername: input.context.url.host, budgetMs: input.budgetMs };
}

/**
 * Attempt the TLS handshake; on success return the connected probe,
 * on failure destroy the underlying socket and return the categorized
 * failure probe. Extracted from {@link runTlsPhase} to stay ≤ 10 LoC.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @returns Final probe envelope (success or failure).
 */
async function attemptTlsUpgrade(input: IRunTlsInput): Promise<INavTransportProbe> {
  const tlsInput = makeTlsUpgradeInput(input);
  try {
    const tlsMs = await input.deps.tlsUpgrade(tlsInput);
    return buildSuccessProbe(input, tlsMs);
  } catch (tlsError) {
    input.tcp.socket.destroy();
    return buildTlsFailureProbe(input, tlsError);
  }
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
  return attemptTlsUpgrade(input);
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
  const third = Math.floor(totalBudgetMs / BUDGET_PHASES);
  return Math.max(MIN_PHASE_BUDGET_MS, third);
}

/** Empty URL parts used when parsing fails — passed through `buildProbeResult`. */
const EMPTY_URL: IUrlParts = { host: '', port: 0, isTls: false };

/** Tagged result of {@link tryParseTargetUrl}. */
interface IParseUrlOutcome {
  readonly isOk: boolean;
  readonly url: IUrlParts;
  readonly errorText: string;
}

/**
 * Safely parse the target URL — `new URL(...)` throws on malformed
 * input, so we wrap that call here to honour the always-resolves
 * contract of {@link probeTransportWithDeps}.
 *
 * @param targetUrl - URL string to parse.
 * @returns Tagged outcome carrying either parsed parts or the error message.
 */
function tryParseTargetUrl(targetUrl: string): IParseUrlOutcome {
  try {
    return { isOk: true, url: parseTargetUrl(targetUrl), errorText: '' };
  } catch (parseError) {
    const normalized = toError(parseError);
    return { isOk: false, url: EMPTY_URL, errorText: normalized.message };
  }
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

/** Bundle of inputs to {@link probeTransportWithDeps} (`max-params: 3`). */
export interface IProbeTransportInput {
  readonly run: IProbeRunInput;
  readonly deps: ITransportProbeDeps;
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
