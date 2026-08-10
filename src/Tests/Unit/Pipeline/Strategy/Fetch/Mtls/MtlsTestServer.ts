/**
 * Shared test harness for the mTLS transport suites. Stands up a local HTTPS
 * server that simulates the Cloudflare API Shield mutual-TLS gate: a request
 * that presents NO client certificate is answered with 403 + an HTML block
 * body (mirroring Cloudflare); a request that DOES present one is answered with
 * 200 JSON + Set-Cookie lines. The bundled OneZero cert/key is reused as the
 * server's TLS identity purely so the suite needs no cert generation; test
 * client agents set `rejectUnauthorized: false` to trust the self-signed host.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Agent, createServer, type Server } from 'node:https';
import type { TLSSocket } from 'node:tls';

import type { ICertBundle } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js';
import { resolveOneZeroClientCert } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js';

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
 * Resolve the bundled OneZero cert bundle for use as test TLS material.
 * @returns The decoded cert + key PEM pair.
 */
function testCertBundle(): ICertBundle {
  return resolveOneZeroClientCert();
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
 * Route one request through the simulated mTLS gate.
 * @param req - The incoming request.
 * @param res - The response to write.
 * @returns True once a response is written.
 */
function handleGate(req: IncomingMessage, res: ServerResponse): boolean {
  const isAuthed = hasClientCert(req);
  if (isAuthed) return sendOk(req, res);
  return sendBlocked(res);
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
    requestCert: true,
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
 * Build a client agent that presents the bundled client certificate.
 * @param bundle - The cert + key to present on the handshake.
 * @returns An HTTPS agent that trusts the self-signed test host.
 */
function buildCertAgent(bundle: ICertBundle): Agent {
  return new Agent({
    cert: bundle.cert,
    key: bundle.key,
    rejectUnauthorized: false,
    keepAlive: false,
  });
}

/**
 * Build a client agent that presents NO client certificate.
 * @returns An HTTPS agent that trusts the self-signed test host.
 */
function buildNoCertAgent(): Agent {
  return new Agent({ rejectUnauthorized: false, keepAlive: false });
}

export type { IGateServer };
export { buildCertAgent, buildNoCertAgent, GATE_COOKIES, startGateServer, testCertBundle };
