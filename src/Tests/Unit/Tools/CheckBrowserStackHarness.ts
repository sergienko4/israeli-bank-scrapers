/**
 * CheckBrowserStackHarness — runs the browser-stack gate in-process for one
 * scenario: a temp manifest and lockfile, and a fake `fetch` routed by URL
 * that records every request and every backoff, so no run leaves the machine.
 *
 * <p>The fixtures are two one-domain `Protocol.js` sources one delta apart,
 * a manifest that accepts that delta and pins both digests, and a responder
 * for each network failure the fetcher must classify.
 */

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { type IFetchIo, runGate } from '../../../../scripts/browser-stack/gate.mjs';

/** A well-formed tag that is deliberately NOT the pinned one. */
const TAG = 'v100.0.0-beta.1';
/** A well-formed asset digest; the gate validates its shape, never its bytes. */
const ASSET_SHA256 = 'f'.repeat(64);
const RAW = 'https://raw.githubusercontent.com';
const JUGGLER = 'juggler/protocol/Protocol.js';
const CLIENT_URL = `${RAW}/microsoft/playwright/v1.64.0/browser_patches/firefox/${JUGGLER}`;
/** Camoufox's newest source layout, tried first. */
const BROWSER_URL = `${RAW}/daijro/camoufox/${TAG}/browser/additions/${JUGGLER}`;
/** The layout before v156.0.1-beta.37, tried only after a 404 on the newest. */
const LEGACY_URL = `${RAW}/daijro/camoufox/${TAG}/additions/${JUGGLER}`;

/** The fetcher's body cap, restated as the contract under test. */
const MAX_BODY_BYTES = 524_288;

const IMPORT_LINE = "const {t} = ChromeUtils.importESModule('resource://testing/t.js');";

/**
 * Lowercase-hex SHA-256 of a body, as the gate computes it.
 *
 * @param text - Body.
 * @returns The digest.
 */
function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * A one-domain `Protocol.js` whose `Network.setRequestInterception` takes `params`.
 *
 * @param params - Params object literal.
 * @returns Source text.
 */
function protocolOf(params: string): string {
  const network = `const Network = { methods: { setRequestInterception: { params: ${params} } } };`;
  const lines = [IMPORT_LINE, network, 'export const protocol = { domains: { Network } };'];
  return lines.join('\n');
}

const BROWSER = protocolOf('{ enabled: t.Boolean }');
const CLIENT = protocolOf('{ enabled: t.Boolean, bypassServiceWorker: t.Optional(t.Boolean) }');
const CLIENT_SHA = sha256Of(CLIENT);
const BROWSER_SHA = sha256Of(BROWSER);

/** The single delta between {@link CLIENT} and {@link BROWSER}. */
const DELTA = {
  channel: 'request',
  kind: 'UNKNOWN-FIELD',
  path: 'Network.setRequestInterception.bypassServiceWorker',
  signature: 'src:Optional(Boolean)|dst:absent',
} as const;
const REASON = 'synthetic: the browser ignores this optional field';

/** Identity of an accepted delta; the manifest adds the reason. */
interface IDeltaId {
  readonly channel: string;
  readonly kind: string;
  readonly path: string;
  readonly signature: string;
}

/** Pinned Protocol.js digests: client per exact version, browser for {@link TAG}. */
interface IPins {
  readonly client: Readonly<Record<string, string>>;
  readonly browser: string;
}

/** Pins of the bytes {@link SERVE} answers with. */
const PINS: IPins = { client: { '1.64.0': CLIENT_SHA }, browser: BROWSER_SHA };

/**
 * A valid manifest pinning {@link TAG}.
 *
 * @param accepted - Accepted deltas, without reasons.
 * @param testedMinor - playwright-core minor the stack was tested with.
 * @param pins - Pinned Protocol.js digests.
 * @returns The document.
 */
function manifestOf(
  accepted: readonly IDeltaId[] = [DELTA],
  testedMinor = '1.64',
  pins: IPins = PINS,
): object {
  const acceptedDeltas = accepted.map((d): object => ({ ...d, reason: REASON }));
  const camoufox = { tag: TAG, linuxX64Sha256: ASSET_SHA256, protocolSha256: pins.browser };
  const playwrightCore = { testedMinor, protocolSha256: pins.client };
  return { $comment: 'test', camoufox, playwrightCore, acceptedDeltas };
}

/**
 * A lockfile resolving playwright-core to `version`.
 *
 * @param version - Locked version.
 * @returns The document.
 */
function lockfileOf(version: string): object {
  return { packages: { 'node_modules/playwright-core': { version } } };
}

/** Answers one request; `init.signal` aborts it when the attempt times out. */
type Responder = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Serves each side's source by URL.
 *
 * @param client - Body of every playwright URL.
 * @param browser - Body of every other URL.
 * @returns The responder.
 */
function serve(client: string, browser: string = BROWSER): Responder {
  return (url: string): Promise<Response> => {
    const text = url.includes('/microsoft/playwright/') ? client : browser;
    const response = new Response(text);
    return Promise.resolve(response);
  };
}

const SERVE = serve(CLIENT);

/**
 * `respond` for the exact client URL; every other URL is served normally.
 *
 * @param respond - Client behaviour under test.
 * @returns The responder.
 */
function onClient(respond: Responder): Responder {
  return (url: string, init: RequestInit): Promise<Response> =>
    url === CLIENT_URL ? respond(url, init) : SERVE(url, init);
}

/**
 * One status per call, then 200 with {@link CLIENT}.
 *
 * @param codes - Status of the 1st, 2nd, … call.
 * @returns The responder.
 */
function statuses(codes: readonly number[]): Responder {
  let call = 0;
  return (url: string, init: RequestInit): Promise<Response> => {
    const status = codes[call] ?? 200;
    call += 1;
    if (status === 200) return SERVE(url, init);
    return refusal(status);
  };
}

/**
 * Each listed URL answers with its status; every other URL is served normally.
 *
 * @param routes - `[url, status]` pairs.
 * @returns The responder.
 */
function failing(routes: readonly (readonly [string, number])[]): Responder {
  const statusOf = new Map(routes);
  return (url: string, init: RequestInit): Promise<Response> => {
    const status = statusOf.get(url) ?? 200;
    if (status === 200) return SERVE(url, init);
    return refusal(status);
  };
}

/**
 * A non-2xx answer.
 *
 * @param status - HTTP status.
 * @returns The response.
 */
function refusal(status: number): Promise<Response> {
  const response = new Response('upstream says no', { status });
  return Promise.resolve(response);
}

/**
 * A response with a fixed body.
 *
 * @param text - Body.
 * @returns The responder.
 */
function body(text: string): Responder {
  return (): Promise<Response> => {
    const response = new Response(text);
    return Promise.resolve(response);
  };
}

/**
 * A 302 to `location`.
 *
 * @param location - `Location` header, absolute or relative.
 * @returns The responder.
 */
function redirectTo(location: string): Responder {
  return (): Promise<Response> => {
    const response = new Response(null, { status: 302, headers: { location } });
    return Promise.resolve(response);
  };
}

/**
 * Never answers; rejects with the abort reason once the attempt times out.
 *
 * @param _url - Unused.
 * @param init - Carries the attempt's signal.
 * @returns A promise that only rejects.
 */
async function hang(_url: string, init: RequestInit): Promise<Response> {
  const missing = new Error('the gate sent no abort signal');
  const signal = init.signal ?? AbortSignal.abort(missing);
  signal.throwIfAborted();
  await once(signal, 'abort');
  throw signal.reason as Error;
}

/**
 * 64 KiB chunks, about 64 GiB in total: only a cap applied while streaming stops in time.
 *
 * @returns The chunks, produced lazily.
 */
function* hugeBody(): Generator<Uint8Array> {
  const chunk = new Uint8Array(65_536);
  for (let index = 0; index < 1_000_000; index += 1) yield chunk;
}

/**
 * A response whose body is {@link hugeBody}.
 *
 * @returns The response.
 */
function endless(): Promise<Response> {
  const chunks = hugeBody();
  // node:stream/web and the DOM lib type the same runtime ReadableStream separately.
  const stream = NodeReadableStream.from(chunks) as ReadableStream<Uint8Array>;
  const response = new Response(stream);
  return Promise.resolve(response);
}

/**
 * Fails like `fetch` does on a refused connection.
 *
 * @returns A rejected promise.
 */
function refused(): Promise<Response> {
  const error = new TypeError('fetch failed');
  return Promise.reject(error);
}

/**
 * Files and network of one run; omitted members are the passing baseline.
 * `client` answers the exact client URL only; `respond` answers every URL.
 */
interface IScenario {
  readonly manifest?: unknown;
  readonly lockfile?: unknown;
  readonly client?: Responder;
  readonly respond?: Responder;
}

/** What one run did. */
interface IRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly urls: readonly string[];
  readonly sleeps: readonly number[];
}

const ROOTS: string[] = [];

/**
 * Remove every temp dir a run created; the suite's `afterEach`.
 *
 * @returns How many dirs were removed.
 */
function removeGateRoots(): number {
  const created = ROOTS.splice(0);
  for (const root of created) rmSync(root, { recursive: true, force: true });
  return created.length;
}

/**
 * Write a JSON document into a directory.
 *
 * @param dir - Directory.
 * @param name - File name.
 * @param doc - Document.
 * @returns Path of the file.
 */
function writeJson(dir: string, name: string, doc: unknown): string {
  const file = join(dir, name);
  const text = JSON.stringify(doc);
  writeFileSync(file, text);
  return file;
}

/**
 * A fresh temp dir, removed after the test.
 *
 * @returns Its path.
 */
function tempDir(): string {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, 'browser-stack-gate-');
  const dir = mkdtempSync(prefix);
  ROOTS.push(dir);
  return dir;
}

/**
 * Run the gate in-process against temp files and a recording fake network.
 *
 * @param args - CLI arguments.
 * @param scenario - Files and network; defaults pass.
 * @returns What the run did.
 */
async function gate(args: readonly string[], scenario: IScenario = {}): Promise<IRun> {
  const dir = tempDir();
  const urls: string[] = [];
  const sleeps: number[] = [];
  const network = scenario.respond ?? SERVE;
  const respond = scenario.client === undefined ? network : onClient(scenario.client);
  const fetchIo: IFetchIo = {
    /**
     * Record, then answer.
     *
     * @param url - Requested URL.
     * @param init - Request options.
     * @returns The response.
     */
    fetchImpl: (url: string, init: RequestInit): Promise<Response> => {
      urls.push(url);
      return respond(url, init);
    },
    /**
     * Record the backoff instead of waiting.
     *
     * @param ms - Requested wait.
     * @returns Resolved at once.
     */
    sleep: (ms: number): Promise<number> => {
      sleeps.push(ms);
      return Promise.resolve(ms);
    },
    timeoutMs: 5,
  };
  const output = { out: '', err: '' };
  const code = await runGate(args, {
    manifestPath: writeJson(dir, 'browser-stack.json', scenario.manifest ?? manifestOf()),
    lockfilePath: writeJson(dir, 'package-lock.json', scenario.lockfile ?? lockfileOf('1.64.0')),
    fetch: fetchIo,
    /**
     * Capture stdout.
     *
     * @param text - Written text.
     * @returns Like `process.stdout.write`.
     */
    stdout: (text: string): boolean => {
      output.out += text;
      return true;
    },
    /**
     * Capture stderr.
     *
     * @param text - Written text.
     * @returns Like `process.stderr.write`.
     */
    stderr: (text: string): boolean => {
      output.err += text;
      return true;
    },
  });
  return { code, ...output, urls, sleeps };
}

export type { IPins, IScenario };
export {
  body,
  BROWSER,
  BROWSER_SHA,
  BROWSER_URL,
  CLIENT,
  CLIENT_SHA,
  CLIENT_URL,
  DELTA,
  endless,
  failing,
  gate,
  hang,
  IMPORT_LINE,
  JUGGLER,
  LEGACY_URL,
  lockfileOf,
  manifestOf,
  MAX_BODY_BYTES,
  PINS,
  RAW,
  REASON,
  redirectTo,
  refused,
  removeGateRoots,
  serve,
  sha256Of,
  statuses,
  TAG,
};
