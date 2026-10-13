/**
 * Unit test for the browser-stack gate CLI (`scripts/check-browser-stack.mjs`
 * and `scripts/browser-stack/{gate,gate-inputs,gate-report,fetch-protocol}.mjs`).
 *
 * <p>The gate is the PR check that the locked playwright-core can still drive
 * the pinned Camoufox over Juggler. Its verdict must be exact — NEW, STALE and
 * DRIFT, per mode — and a gate that cannot decide must never pass or fail as
 * if it had: every usage, manifest, lockfile, network or parse problem exits
 * 2. The network is a fake `fetch` routed by URL, so no case leaves the
 * machine; `npm run lint:browser-stack` checks the real upstream files.
 *
 * <p>Expected lines are written out literally rather than rebuilt from the
 * renderer, so a formatting change is a visible test change.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';

import { type IFetchIo, runGate } from '../../../../scripts/browser-stack/gate.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const ENTRY = join(THIS_DIR, '../../../../scripts/check-browser-stack.mjs');

/** A well-formed tag that is deliberately NOT the pinned one. */
const TAG = 'v100.0.0-beta.1';
const RAW = 'https://raw.githubusercontent.com';
const JUGGLER = 'juggler/protocol/Protocol.js';
const CLIENT_URL = `${RAW}/microsoft/playwright/v1.64.0/browser_patches/firefox/${JUGGLER}`;
const BROWSER_URL = `${RAW}/daijro/camoufox/${TAG}/additions/${JUGGLER}`;

/** The fetcher's body cap, restated as the contract under test. */
const MAX_BODY_BYTES = 524_288;

const IMPORT_LINE = "const {t} = ChromeUtils.importESModule('resource://testing/t.js');";

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
const CLIENT_SHA = createHash('sha256').update(CLIENT).digest('hex');
const BROWSER_SHA = createHash('sha256').update(BROWSER).digest('hex');

/** The single delta between {@link CLIENT} and {@link BROWSER}. */
const DELTA = {
  channel: 'request',
  kind: 'UNKNOWN-FIELD',
  path: 'Network.setRequestInterception.bypassServiceWorker',
  signature: 'src:Optional(Boolean)|dst:absent',
} as const;
const REASON = 'synthetic: the browser ignores this optional field';
const CELLS = 'request UNKNOWN-FIELD          Network.setRequestInterception.bypassServiceWorker';
const NEW_LINE = `NEW       ${CELLS}  src:Optional(Boolean)|dst:absent`;
const STALE_LINE = `STALE     ${CELLS}  src:Optional(Boolean)|dst:absent`;
const DRIFT_LINE =
  'DRIFT     playwright-core minor 1.64 ≠ testedMinor 1.63' +
  ' (bump testedMinor only after the contract test passes)';
const MODE_ERROR = 'USAGE --mode must be gate or candidate';
const USAGE_LINE =
  'usage: node scripts/check-browser-stack.mjs [--playwright <x.y.z>] [--camoufox <tag>]' +
  ' [--mode gate|candidate] [--json]';

/** Identity of an accepted delta; the manifest adds the reason. */
interface IDeltaId {
  readonly channel: string;
  readonly kind: string;
  readonly path: string;
  readonly signature: string;
}

/**
 * A valid manifest pinning {@link TAG}.
 *
 * @param accepted - Accepted deltas, without reasons.
 * @param testedMinor - playwright-core minor the stack was tested with.
 * @returns The document.
 */
function manifestOf(accepted: readonly IDeltaId[] = [DELTA], testedMinor = '1.64'): object {
  const acceptedDeltas = accepted.map((d): object => ({ ...d, reason: REASON }));
  const camoufox = { tag: TAG };
  return { $comment: 'test', camoufox, playwrightCore: { testedMinor }, acceptedDeltas };
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
    const response = new Response('upstream says no', { status });
    return Promise.resolve(response);
  };
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

afterEach(() => {
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

/** A run whose findings decide the exit code. */
interface IVerdictCase {
  readonly id: string;
  readonly what: string;
  readonly args: readonly string[];
  readonly scenario: IScenario;
  readonly code: 0 | 1;
  readonly lines: readonly string[];
}

const CHANGED_SIGNATURE = { ...DELTA, signature: 'src:Optional(String)|dst:absent' };

const VERDICT_CASES: readonly IVerdictCase[] = [
  {
    id: 'BSG-2',
    what: 'gate fails a delta the manifest does not accept',
    args: [],
    scenario: { manifest: manifestOf([]) },
    code: 1,
    lines: [NEW_LINE, 'FAIL: 1 new, 0 stale, 0 accepted'],
  },
  {
    id: 'BSG-3',
    what: 'gate fails an accepted delta that is gone',
    args: [],
    scenario: { respond: serve(BROWSER) },
    code: 1,
    lines: [STALE_LINE, 'FAIL: 0 new, 1 stale, 0 accepted'],
  },
  {
    id: 'BSG-4',
    what: 'gate fails a playwright-core minor other than testedMinor',
    args: [],
    scenario: { manifest: manifestOf([DELTA], '1.63') },
    code: 1,
    lines: [DRIFT_LINE, 'FAIL: 0 new, 0 stale, 1 accepted, drift'],
  },
  {
    id: 'BSG-5',
    what: 'gate reports a changed signature as both STALE and NEW',
    args: [],
    scenario: { manifest: manifestOf([CHANGED_SIGNATURE]) },
    code: 1,
    lines: [
      NEW_LINE,
      `STALE     ${CELLS}  src:Optional(String)|dst:absent`,
      'FAIL: 1 new, 1 stale, 0 accepted',
    ],
  },
  {
    id: 'BSG-6',
    what: 'candidate fails a delta the manifest does not accept',
    args: ['--mode', 'candidate'],
    scenario: { manifest: manifestOf([]) },
    code: 1,
    lines: [NEW_LINE, 'FAIL: 1 new, 0 stale, 0 accepted'],
  },
  {
    id: 'BSG-7',
    what: 'candidate passes STALE and DRIFT, marked [info]',
    args: ['--mode', 'candidate'],
    scenario: { respond: serve(BROWSER), manifest: manifestOf([DELTA], '1.63') },
    code: 0,
    lines: [
      `${STALE_LINE} [info]`,
      `${DRIFT_LINE} [info]`,
      'PASS: 0 new, 1 stale, 0 accepted, drift',
    ],
  },
];

/** A run the gate cannot decide: exit 2, nothing on stdout. */
interface IInfraCase {
  readonly id: string;
  readonly what: string;
  readonly args?: readonly string[];
  readonly scenario: IScenario;
  readonly err: string;
  readonly fetches: number;
  readonly sleeps: readonly number[];
}

const BACKOFF = [1000, 2000] as const;
const OFF_LIST = 'https://example.com/Protocol.js';
const OVER_CAP = CLIENT.padEnd(MAX_BODY_BYTES + 1, ' ');

const INFRA_CASES: readonly IInfraCase[] = [
  {
    id: 'BSG-20',
    what: 'every attempt times out',
    scenario: { client: hang },
    err: `FETCH-FAILED ${CLIENT_URL} timed out after 5 ms`,
    fetches: 4,
    sleeps: BACKOFF,
  },
  {
    id: 'BSG-21',
    what: 'every attempt is refused',
    scenario: { client: refused },
    err: `FETCH-FAILED ${CLIENT_URL} network error (fetch failed)`,
    fetches: 4,
    sleeps: BACKOFF,
  },
  {
    id: 'BSG-22',
    what: 'a 404 is final',
    scenario: { client: statuses([404]) },
    err: `FETCH-FAILED ${CLIENT_URL} HTTP 404`,
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-23',
    what: 'a 500 on all 3 attempts',
    scenario: { client: statuses([500, 500, 500]) },
    err: `FETCH-FAILED ${CLIENT_URL} HTTP 500`,
    fetches: 4,
    sleeps: BACKOFF,
  },
  {
    id: 'BSG-24',
    what: 'a body that never ends is cut at the cap',
    scenario: { client: endless },
    err: `FETCH-FAILED ${CLIENT_URL} body exceeds ${String(MAX_BODY_BYTES)} bytes`,
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-25',
    what: 'a body one byte over the cap',
    scenario: { client: body(OVER_CAP) },
    err: `FETCH-FAILED ${CLIENT_URL} body exceeds ${String(MAX_BODY_BYTES)} bytes`,
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-26',
    what: 'a redirect off the allowlist is never followed',
    scenario: { client: redirectTo(OFF_LIST) },
    err: `FETCH-FAILED ${OFF_LIST} is not allowlisted (only https://raw.githubusercontent.com)`,
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-27',
    what: 'a redirect that downgrades to http',
    scenario: { client: redirectTo('http://raw.githubusercontent.com/x') },
    err: 'FETCH-FAILED http://raw.githubusercontent.com/x is not allowlisted',
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-28',
    what: 'a redirect loop stops after 3 hops',
    scenario: { client: redirectTo(CLIENT_URL) },
    err: `FETCH-FAILED ${CLIENT_URL} redirected more than 3 times`,
    fetches: 5,
    sleeps: [],
  },
  {
    id: 'BSG-29',
    what: 'an invalid manifest',
    scenario: { manifest: {} },
    err: 'MANIFEST-INVALID /$comment',
    fetches: 0,
    sleeps: [],
  },
  {
    id: 'BSG-30',
    what: 'a lockfile without playwright-core',
    scenario: { lockfile: { packages: {} } },
    err: 'packages["node_modules/playwright-core"].version is not x.y.z',
    fetches: 0,
    sleeps: [],
  },
  {
    id: 'BSG-31',
    what: 'a lockfile resolving a prerelease',
    scenario: { lockfile: lockfileOf('1.64.0-beta.1') },
    err: 'LOCKFILE-INVALID',
    fetches: 0,
    sleeps: [],
  },
  {
    id: 'BSG-32',
    what: 'a browser source outside the grammar',
    scenario: { respond: serve(CLIENT, `${IMPORT_LINE}\nexport const protocol = eval(1);`) },
    err: 'UNPARSEABLE browser line 2: expected an object literal',
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-33',
    what: 'an unknown flag',
    args: ['--nope'],
    scenario: {},
    err: "USAGE Unknown option '--nope'",
    fetches: 0,
    sleeps: [],
  },
  {
    id: 'BSG-34',
    what: 'an unknown mode',
    args: ['--mode', 'bogus'],
    scenario: {},
    err: `${MODE_ERROR}\n${USAGE_LINE}\n`,
    fetches: 0,
    sleeps: [],
  },
  {
    id: 'BSG-35',
    what: 'a prerelease --playwright',
    args: ['--playwright', '1.64.0-beta.1'],
    scenario: {},
    err: 'USAGE --playwright must be a stable playwright-core version x.y.z',
    fetches: 0,
    sleeps: [],
  },
  {
    id: 'BSG-36',
    what: 'a --camoufox that is not a release tag',
    args: ['--camoufox', '152.0.4'],
    scenario: {},
    err: 'USAGE --camoufox must be a Camoufox release tag',
    fetches: 0,
    sleeps: [],
  },
  {
    id: 'BSG-37',
    what: 'a positional argument',
    args: ['extra'],
    scenario: {},
    err: 'USAGE Unexpected argument',
    fetches: 0,
    sleeps: [],
  },
];

describe('browser-stack gate verdict', () => {
  it('[BSG-1] passes an accepted delta from the default pair and prints both sha256 values', async () => {
    const run = await gate([]);
    expect(run.code).toBe(0);
    expect(run.urls).toEqual([CLIENT_URL, BROWSER_URL]);
    expect(run.out).toContain(`playwright-core 1.64.0 × Camoufox ${TAG} (mode=gate)\n`);
    expect(run.out).toContain(`  client sha256=${CLIENT_SHA}  browser sha256=${BROWSER_SHA}\n`);
    expect(run.out).toContain(`ACCEPTED  ${CELLS}\n`);
    expect(run.out).toContain('PASS: 0 new, 0 stale, 1 accepted\n');
    expect(run.err).toBe('');
  });

  it.each(VERDICT_CASES)('[$id] $what', async ({ args, scenario, code, lines }) => {
    const run = await gate(args, scenario);
    expect(run.code).toBe(code);
    for (const line of lines) expect(run.out).toContain(`${line}\n`);
    expect(run.err).toBe('');
  });

  it('[BSG-8] --playwright and --camoufox override the lockfile and the manifest', async () => {
    const args = ['--playwright', '1.65.2', '--camoufox', 'v1.2.3-beta.4'];
    const run = await gate(args, { lockfile: {} });
    const client = `${RAW}/microsoft/playwright/v1.65.2/browser_patches/firefox/${JUGGLER}`;
    expect(run.urls).toEqual([client, `${RAW}/daijro/camoufox/v1.2.3-beta.4/additions/${JUGGLER}`]);
    expect(run.out).toContain('playwright-core 1.65.2 × Camoufox v1.2.3-beta.4 (mode=gate)\n');
    expect(run.code).toBe(1);
  });
});

describe('browser-stack gate fetch policy', () => {
  it('[BSG-10] recovers when a 5xx clears, after backing off 1 s then 2 s', async () => {
    const run = await gate([], { client: statuses([503, 503]) });
    expect(run.code).toBe(0);
    expect(run.sleeps).toEqual(BACKOFF);
    const clientCalls = run.urls.filter((url): boolean => url === CLIENT_URL);
    expect(clientCalls).toHaveLength(3);
  });

  it('[BSG-11] accepts a body of exactly the cap', async () => {
    const padded = CLIENT.padEnd(MAX_BODY_BYTES, ' ');
    const run = await gate([], { client: body(padded) });
    expect(run.code).toBe(0);
  });

  it('[BSG-12] follows a relative redirect that stays on the allowlist', async () => {
    const run = await gate([], { client: redirectTo('/microsoft/playwright/moved.js') });
    expect(run.code).toBe(0);
    expect(run.urls).toContain(`${RAW}/microsoft/playwright/moved.js`);
  });

  it.each(INFRA_CASES)('[$id] exits 2 on $what', async ({ args, scenario, ...expected }) => {
    const run = await gate(args ?? [], scenario);
    expect(run.code).toBe(2);
    expect(run.err).toContain(expected.err);
    expect(run.out).toBe('');
    expect(run.urls).toHaveLength(expected.fetches);
    expect(run.sleeps).toEqual(expected.sleeps);
    const offList = run.urls.filter((url): boolean => url === OFF_LIST);
    expect(offList).toEqual([]);
  });
});

describe('browser-stack gate output', () => {
  it('[BSG-40] --json prints the whole report', async () => {
    const run = await gate(['--json']);
    const report: unknown = JSON.parse(run.out);
    expect(report).toEqual({
      playwright: '1.64.0',
      camoufox: TAG,
      mode: 'gate',
      testedMinor: '1.64',
      sha256: { client: CLIENT_SHA, browser: BROWSER_SHA },
      new: [],
      stale: [],
      accepted: [{ ...DELTA, reason: REASON }],
      drift: false,
      exit: 0,
    });
  });

  it('[BSG-41] --json prints an infrastructure failure as JSON and on stderr', async () => {
    const run = await gate(['--json', '--mode', 'bogus']);
    const report: unknown = JSON.parse(run.out);
    expect(run.code).toBe(2);
    expect(report).toEqual({ exit: 2, errors: [MODE_ERROR, USAGE_LINE] });
    expect(run.err).toBe(`${MODE_ERROR}\n${USAGE_LINE}\n`);
  });

  it('[BSG-42] the real entry exits 2 on a usage error, before any network', () => {
    const result = spawnSync(process.execPath, [ENTRY, '--mode', 'bogus'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(`${MODE_ERROR}\n${USAGE_LINE}\n`);
    expect(result.stdout).toBe('');
  });
});
