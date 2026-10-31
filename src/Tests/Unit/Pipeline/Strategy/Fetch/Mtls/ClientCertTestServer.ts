/**
 * Loopback HTTPS server for the dynamic client-certificate suites (N26). It
 * asks every client for a certificate (`requestCert`) but admits a certless
 * handshake, so each answer can report what the client actually presented:
 * `/peer` answers `{ sha256 }` (the SHA-256 hex of the presented DER, `''`
 * when none) and `/redirect` answers 302 to `/peer`. Every served path is
 * recorded, so a suite can prove a redirect was never followed. The server
 * identity is the loopback fixture of `MtlsTestServer` (SAN `127.0.0.1`).
 * `recordPresented` installs the mocked-transport seam and records what each
 * request would present, for suites that touch no network.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Agent, createServer, type Server } from 'node:https';
import type { TLSSocket } from 'node:tls';

import type { IPresentedCert } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsAgentSource.js';
import {
  type MtlsFallback,
  setMtlsFetchFallback,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import type { ICertBundle } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { boundPort, makeClose, testCertBundle } from './MtlsTestServer.js';

/** A running peer-echo server. */
interface IPeerServer {
  readonly origin: string;
  readonly seen: string[];
  readonly close: () => Promise<void>;
}

/** The `/peer` answer. */
interface IPeerEcho {
  readonly sha256: string;
}

/**
 * The SHA-256 hex of the certificate the peer presented.
 * @param req - The incoming request.
 * @returns Hex digest, or `''` when no certificate was presented.
 */
function presentedSha256(req: IncomingMessage): string {
  const socket = req.socket as TLSSocket;
  const peer = socket.getPeerCertificate();
  if (Object.keys(peer).length === 0) return '';
  return createHash('sha256').update(peer.raw).digest('hex');
}

/**
 * Answer `/redirect` with a 302 to `/peer`, anything else with the peer echo.
 * @param seen - Paths served so far, appended to.
 * @param req - The incoming request.
 * @param res - The response to write.
 * @returns True once the response is written.
 */
function handlePeer(seen: string[], req: IncomingMessage, res: ServerResponse): boolean {
  const path = req.url ?? '/';
  seen.push(path);
  if (path === '/redirect') {
    res.writeHead(302, { location: '/peer' });
    res.end();
    return true;
  }
  const echo: IPeerEcho = { sha256: presentedSha256(req) };
  const body = JSON.stringify(echo);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
  return true;
}

/**
 * Describe a listening server.
 * @param server - The listening server.
 * @param seen - Its served-path log.
 * @returns Origin, log and teardown.
 */
function describePeer(server: Server, seen: string[]): IPeerServer {
  const port = boundPort(server);
  const close = makeClose(server);
  return { origin: `https://127.0.0.1:${String(port)}`, seen, close };
}

/**
 * Start a peer-echo server on an ephemeral loopback port.
 * @returns Promise resolving with the running server.
 */
function startPeerServer(): Promise<IPeerServer> {
  const bundle = testCertBundle();
  const seen: string[] = [];
  const options = { cert: bundle.cert, key: bundle.key, requestCert: true };
  const server = createServer({ ...options, rejectUnauthorized: false }, (req, res) =>
    handlePeer(seen, req, res),
  );
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const running = describePeer(server, seen);
      resolve(running);
    });
  });
}

/**
 * A client agent presenting any certificate (or none) that trusts only the
 * loopback server identity, so issued test certificates reach the server.
 * @param pair - Certificate to present, or false for none.
 * @returns HTTPS agent without keep-alive (one handshake per request).
 */
function buildTrustingAgent(pair: ICertBundle | false): Agent {
  const { cert: serverCert } = testCertBundle();
  const base = { ca: [serverCert], rejectUnauthorized: true, keepAlive: false };
  if (pair === false) return new Agent(base);
  return new Agent({ ...base, cert: pair.cert, key: pair.key });
}

/**
 * An empty JSON 200, the mocked transport's answer.
 * @returns Procedure carrying the Response.
 */
function answerEmpty(): Promise<Procedure<Response>> {
  const response = Response.json({});
  const answer = succeed(response);
  return Promise.resolve(answer);
}

/**
 * Install the mocked-transport seam, answering `{}` and recording what each
 * request would present. Clear it with `setMtlsFetchFallback()`.
 * @returns The presented certificates, in request order (`false` for none).
 */
function recordPresented(): (IPresentedCert | false)[] {
  const presented: (IPresentedCert | false)[] = [];
  /**
   * Record one request and answer it.
   * @param request - The request the transport would send.
   * @returns The empty answer.
   */
  const fallback: MtlsFallback = request => {
    presented.push(request.presented);
    return answerEmpty();
  };
  setMtlsFetchFallback(fallback);
  return presented;
}

export type { IPeerEcho, IPeerServer };
export { buildTrustingAgent, recordPresented, startPeerServer };
