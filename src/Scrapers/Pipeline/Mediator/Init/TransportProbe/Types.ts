/**
 * Shared types and sentinel constants for the Node-level transport
 * probe. Split out of the former single-file `NavigationTransportProbe`
 * so every probe sub-module (Url / Dns / Tcp / Tls / Result / Probe)
 * imports its contracts from one place.
 */

import type * as net from 'node:net';

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
export interface ITcpConnectInput {
  readonly host: string;
  readonly port: number;
  readonly budgetMs: number;
}

/** Bundle of inputs to TLS-upgrade (`max-params: 3`). */
export interface ITlsUpgradeInput {
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

/** URL parts the probe needs to pick TCP-vs-TLS path and port. */
export interface IUrlParts {
  readonly host: string;
  readonly port: number;
  readonly isTls: boolean;
}

/** Bundle of inputs to `probeTransportWithDeps` (`max-params: 3`). */
export interface IProbeRunInput {
  readonly targetUrl: string;
  readonly totalBudgetMs: number;
  readonly startedMsAfterGotoFailure: number;
}

/** Internal probe context built once from {@link IProbeRunInput}. */
export interface IProbeContext {
  readonly url: IUrlParts;
  readonly run: IProbeRunInput;
}

/** Bundle of fields shared by every probe outcome (success or fail). */
export interface IProbeEnvelope {
  readonly dnsLookupMs: number;
  readonly tcpConnectMs: number;
  readonly tlsHandshakeMs: number;
  readonly resolvedAddress: string;
  readonly errorText: string;
}

/** Bundle of inputs to `probeTransportWithDeps` (`max-params: 3`). */
export interface IProbeTransportInput {
  readonly run: IProbeRunInput;
  readonly deps: ITransportProbeDeps;
}

/** Sentinel placeholder fields used when a phase did not run. */
export const EMPTY_ADDRESS = '';
export const ZERO_MS = 0;
/** Outcome used for placeholders and uncategorized errors. */
export const OUTCOME_OTHER_ERROR: TransportProbeOutcome = 'other-error';

/** Sensible defaults for every envelope field. */
export const EMPTY_ENVELOPE: IProbeEnvelope = {
  dnsLookupMs: ZERO_MS,
  tcpConnectMs: ZERO_MS,
  tlsHandshakeMs: ZERO_MS,
  resolvedAddress: EMPTY_ADDRESS,
  errorText: '',
};

/** Empty URL parts used when parsing fails — passed through `buildProbeResult`. */
export const EMPTY_URL: IUrlParts = { host: '', port: 0, isTls: false };
