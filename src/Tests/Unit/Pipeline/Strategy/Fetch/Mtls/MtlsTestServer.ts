/**
 * Shared test harness for the mTLS transport suites. Stands up a local HTTPS
 * server that simulates the Cloudflare API Shield mutual-TLS gate: a request
 * that presents NO client certificate is answered with 403 + an HTML block
 * body (mirroring Cloudflare); a request that DOES present one is answered with
 * 200 JSON + Set-Cookie lines. The server's TLS identity is a dedicated,
 * self-signed loopback fixture (`MtlsTestCertData`, SAN `IP:127.0.0.1`) — NOT
 * the production OneZero credential — so the suite is decoupled from cert
 * rotation and from `ONEZERO_MTLS_*` env overrides. Because the fixture SAN
 * pins `127.0.0.1`, client agents validate the server with
 * `rejectUnauthorized: true` and need no hostname-check override.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Agent, createServer, type Server } from 'node:https';
import type { TLSSocket } from 'node:tls';

import type { ICertBundle } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js';
import { MTLS_TEST_CERT_B64, MTLS_TEST_KEY_B64 } from './MtlsTestCertData.js';

/** A running gate server plus the URLs + teardown callers need. */
interface IGateServer {
  readonly baseUrl: string;
  readonly restUrl: string;
  readonly gqlUrl: string;
  readonly close: () => Promise<void>;
}

/** Set-Cookie lines the gate emits on a 200 so passthrough can be asserted. */
const GATE_COOKIES: readonly string[] = ['MTLS_SESSION=1; Path=/; HttpOnly', 'MTLS_CSRF=2; Path=/'];

/**
 * Decode a base64-wrapped PEM back to its text form.
 * @param b64 - Base64 of the PEM (embedded whitespace is tolerated).
 * @returns The decoded PEM text.
 */
function decodePem(b64: string): string {
  const compact = b64.replaceAll(/\s+/g, '');
  const buffer = Buffer.from(compact, 'base64');
  return buffer.toString('utf8');
}

/**
 * Decode the self-signed loopback TEST cert bundle. This never touches the
 * production OneZero credential and is never affected by `ONEZERO_MTLS_*` env
 * overrides, so the suite stays deterministic across cert rotations.
 * @returns The decoded test cert + key PEM pair.
 */
function testCertBundle(): ICertBundle {
  return { cert: decodePem(MTLS_TEST_CERT_B64), key: decodePem(MTLS_TEST_KEY_B64) };
}

/**
 * Report whether the peer presented a client certificate.
 * @param req - The incoming request whose socket is inspected.
 * @returns True when a non-empty peer certificate is present.
 */
function hasClientCert(req: IncomingMessage): boolean {
  const socket = req.socket as TLSSocket;
  const peer = socket.getPeerCertificate();
  const keys = Object.keys(peer);
  return keys.length > 0;
}

/**
 * Answer a certless request with the Cloudflare-style 403 HTML block.
 * @param res - The response to write.
 * @returns True once the response is written.
 */
function sendBlocked(res: ServerResponse): boolean {
  res.writeHead(403, { 'content-type': 'text/html' });
  res.end('<!DOCTYPE html><html><body>Access denied (mTLS)</body></html>');
  return true;
}

/**
 * Answer an authenticated request with 200 JSON + Set-Cookie lines.
 * GraphQL paths return a {data} envelope; all others echo the method.
 * @param req - The incoming request (method + url drive the body shape).
 * @param res - The response to write.
 * @returns True once the response is written.
 */
function sendOk(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '/';
  const isGraphql = url.includes('graphql');
  res.setHeader('set-cookie', [...GATE_COOKIES]);
  res.writeHead(200, { 'content-type': 'application/json' });
  const payload = isGraphql ? { data: { me: 'ok' } } : { ok: true, method: req.method };
  const body = JSON.stringify(payload);
  res.end(body);
  return true;
}

/**
 * Never write a response — leaves the request hanging so the client-side
 * AbortSignal.timeout is exercised deterministically.
 * @returns True (the socket is intentionally left open).
 */
function sendHang(): boolean {
  return true;
}

/**
 * Write response headers + a partial body, then destroy the socket so the
 * client observes a premature close (truncated body) mid-stream.
 * @param res - The response to write then abort.
 * @returns True once the partial write + destroy is issued.
 */
function sendPremature(res: ServerResponse): boolean {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.write('{"partial":');
  res.socket?.destroy();
  return true;
}

/**
 * Route one request through the simulated mTLS gate.
 * @param req - The incoming request.
 * @param res - The response to write.
 * @returns True once a response is written.
 */
function handleGate(req: IncomingMessage, res: ServerResponse): boolean {
  const isAuthed = hasClientCert(req);
  if (!isAuthed) return sendBlocked(res);
  const url = req.url ?? '/';
  if (url.includes('hang')) return sendHang();
  if (url.includes('premature')) return sendPremature(res);
  return sendOk(req, res);
}

/**
 * Read the ephemeral port a listening server bound to.
 * @param server - The listening HTTPS server.
 * @returns The bound TCP port.
 */
function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') return 0;
  return address.port;
}

/**
 * Build the teardown callback that closes the server.
 * @param server - The server to close.
 * @returns A close function resolving once the server is fully closed.
 */
function makeClose(server: Server): () => Promise<void> {
  /**
   * Close the underlying server, resolving once fully torn down.
   * @returns Promise resolving after close completes.
   */
  const close = (): Promise<void> =>
    new Promise(resolve => {
      server.close(() => {
        resolve();
      });
    });
  return close;
}

/**
 * Assemble the IGateServer descriptor from a bound server.
 * @param server - The listening HTTPS server.
 * @returns URLs + teardown for the running gate.
 */
function describeServer(server: Server): IGateServer {
  const port = boundPort(server);
  const baseUrl = `https://127.0.0.1:${String(port)}/`;
  const restUrl = `${baseUrl}devices/token`;
  const gqlUrl = `${baseUrl}graphql`;
  const close = makeClose(server);
  return { baseUrl, restUrl, gqlUrl, close };
}

/**
 * Start the local mTLS-gate HTTPS server on an ephemeral port.
 * @returns Promise resolving with the running gate descriptor.
 */
function startGateServer(): Promise<IGateServer> {
  const bundle = testCertBundle();
  const options = {
    cert: bundle.cert,
    key: bundle.key,
    ca: [bundle.cert],
    requestCert: true,
    // Accept a certless handshake so the handler can return the app-layer 403
    // that is the behaviour under test (mirrors Cloudflare). This does NOT
    // relax server-cert validation — clients still verify via `ca` below.
    rejectUnauthorized: false,
  };
  const server = createServer(options, handleGate);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const descriptor = describeServer(server);
      resolve(descriptor);
    });
  });
}

/**
 * Build a client agent that presents the test client certificate and fully
 * validates the loopback server against the self-signed CA (SAN `127.0.0.1`).
 * @param bundle - The cert + key to present on the handshake.
 * @returns An HTTPS agent that trusts the test host via its self-CA.
 */
function buildCertAgent(bundle: ICertBundle): Agent {
  return new Agent({
    cert: bundle.cert,
    key: bundle.key,
    ca: [bundle.cert],
    rejectUnauthorized: true,
    keepAlive: false,
  });
}

/**
 * Build a client agent that presents NO client certificate but still fully
 * validates the loopback server against the self-signed CA (SAN `127.0.0.1`).
 * @returns An HTTPS agent that trusts the test host via its self-CA.
 */
function buildNoCertAgent(): Agent {
  const { cert } = testCertBundle();
  return new Agent({ ca: [cert], rejectUnauthorized: true, keepAlive: false });
}

export type { IGateServer };
export { buildCertAgent, buildNoCertAgent, GATE_COOKIES, startGateServer, testCertBundle };
