/**
 * Time and fetch bounds of the weekly browser-stack watch (`scripts/browser-stack/watch.mjs`).
 *
 * <p>The workflow gives the job `timeout-minutes`; the watch must write its
 * report within it even when upstream is at its slowest. Here the real gate
 * judges the largest candidate set — three playwright-core versions × the ten
 * newest Camoufox releases plus the older one camoufox-js selects — against a
 * fake network on a virtual clock. In the worst case each input answers on
 * its last attempt at the edge of its timeout (any later and the watch exits
 * 2 without judging anything), and every `Protocol.js` attempt times out.
 * Elapsed time is simulated and the bound is computed from the real timeout,
 * back-off and concurrency constants, never from wall-clock time.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IPlatformAssetCheck } from '../../../../scripts/browser-stack/camoufox-releases.mjs';
import {
  CANDIDATE_COUNT,
  RELEASES_URL,
} from '../../../../scripts/browser-stack/camoufox-releases.mjs';
import {
  ALLOWED_HOST,
  ATTEMPT_TIMEOUT_MS,
  BACKOFF_MS,
} from '../../../../scripts/browser-stack/fetch-protocol.mjs';
import type { IFetchIo, IGateIo } from '../../../../scripts/browser-stack/gate.mjs';
import {
  PACKUMENT_TIMEOUT_MS,
  PACKUMENT_URL,
} from '../../../../scripts/browser-stack/playwright-versions.mjs';
import {
  GATE_CONCURRENCY,
  type IWatchIo,
  runWatch,
} from '../../../../scripts/browser-stack/watch.mjs';
import {
  ASSET_CHECK,
  type IPrinted,
  lockfileWith,
  packageWith,
  printingIo,
  RANGE,
  release,
  removeInputs,
  writeInputs,
} from '../../Helpers/BrowserStackWatchFixtures.js';
import { fakeFetch } from '../../Helpers/FakeFetch.js';
import { type IVirtualClock, virtualClock } from '../../Helpers/VirtualClock.js';

const HERE = fileURLToPath(import.meta.url);
const HERE_DIR = dirname(HERE);
const ROOT = join(HERE_DIR, '../../../..');
const WORKFLOW_PATH = join(ROOT, '.github/workflows/browser-stack-watch.yml');
const WORKFLOW = readFileSync(WORKFLOW_PATH, 'utf8');
const TIMEOUT_MINUTES = /timeout-minutes:\s*(\d+)/u.exec(WORKFLOW);
const MINUTE_MS = 60_000;

/** The job's limit, as the workflow sets it. */
const JOB_LIMIT_MS = Number(TIMEOUT_MINUTES?.[1]) * MINUTE_MS;

/** Checkout, setup-node with its npm cache, and `npm ci`, before the watch step starts. */
const SETUP_ALLOWANCE_MS = 3 * MINUTE_MS;

/** Attempts per fetch: one, then one per back-off. */
const ATTEMPTS = BACKOFF_MS.length + 1;

/** Every back-off wait of one fetch. */
const BACKOFF_TOTAL_MS = BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);

/**
 * The longest one bounded fetch can take: every attempt runs to its timeout.
 *
 * @param timeoutMs - Timeout of one attempt.
 * @returns Milliseconds.
 */
function slowestFetchMs(timeoutMs: number): number {
  return ATTEMPTS * timeoutMs + BACKOFF_TOTAL_MS;
}

const LOCKED = '1.63.1';
const NEXT = '1.64.2';
const IN_RANGE = '1.65.1';
const VERSIONS = [LOCKED, NEXT, IN_RANGE];
const SELECTED_TAG = 'v152.0.4-beta.30';

/** The ten newest releases are prereleases, so the selected one is an eleventh tag. */
const PAGE = [
  ...Array.from({ length: CANDIDATE_COUNT }, (_, i) =>
    release(`v156.0.1-beta.${String(50 - i)}`, true),
  ),
  release(SELECTED_TAG),
];
const TAGS = PAGE.map(r => r.tag_name);

/** Every pair, in report order: version-major. */
const PAIRS = VERSIONS.flatMap(version => TAGS.map(tag => `${version} ${tag}`));

/** One client schema per version, one first browser candidate per tag. */
const PROTOCOL_URLS = VERSIONS.length + TAGS.length;

const PUBLISHED = [LOCKED, '1.64.0', NEXT, '1.65.0', IN_RANGE, '2.0.0'];
const PUBLISHED_ENTRIES = PUBLISHED.map((version): [string, object] => [version, {}]);

/** `latest` is the in-range version, beside a new major. */
const PACKUMENT = {
  'dist-tags': { latest: IN_RANGE },
  versions: Object.fromEntries(PUBLISHED_ENTRIES),
};

/** The watch's inputs: releases page and packument. */
const INPUT_BODIES: Readonly<Partial<Record<string, string>>> = {
  [RELEASES_URL]: JSON.stringify(PAGE),
  [PACKUMENT_URL]: JSON.stringify(PACKUMENT),
};

/** Inputs: the slower of releases page and packument, both read at once. */
const PACKUMENT_WORST_MS = slowestFetchMs(PACKUMENT_TIMEOUT_MS);
const RELEASES_WORST_MS = slowestFetchMs(ATTEMPT_TIMEOUT_MS);
const INPUTS_WORST_MS = Math.max(PACKUMENT_WORST_MS, RELEASES_WORST_MS);

/**
 * Gate runs: each `Protocol.js` URL is fetched once and {@link GATE_CONCURRENCY} gates
 * run at once, so the URLs take this many rounds of the slowest fetch. One gate at a
 * time with no cache, the same 33 pairs would need about half an hour.
 */
const WAVES = Math.ceil(PROTOCOL_URLS / GATE_CONCURRENCY);
const GATES_WORST_MS = WAVES * RELEASES_WORST_MS;
const BOUND_MS = INPUTS_WORST_MS + GATES_WORST_MS;

/** Per-host attempt timeout: the packument has its own. */
const HOST_TIMEOUT_MS: Readonly<Record<string, number>> = {
  'registry.npmjs.org': PACKUMENT_TIMEOUT_MS,
};

/** A fetch implementation, as the watch's fetch I/O takes it. */
type FetchImpl = NonNullable<IFetchIo['fetchImpl']>;

/** What one run produced. */
interface IRun extends IPrinted {
  readonly code: 0 | 2;
}

afterAll(() => {
  removeInputs();
});

/**
 * The attempt timeout the fetcher sets for `url`.
 *
 * @param url - Fetched URL.
 * @returns Milliseconds.
 */
function timeoutOf(url: string): number {
  const { host } = new URL(url);
  return HOST_TIMEOUT_MS[host] ?? ATTEMPT_TIMEOUT_MS;
}

/**
 * What an attempt whose signal fired throws.
 *
 * @returns Never; always throws.
 */
function timedOut(): never {
  throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

/**
 * The slowest network: every attempt takes its whole timeout; inputs answer on
 * their last attempt, `Protocol.js` never does.
 *
 * @param clock - The virtual clock.
 * @param calls - Receives every fetched URL.
 * @returns The fetch implementation.
 */
function slowestNetwork(clock: IVirtualClock, calls: string[]): FetchImpl {
  return async (url: string): Promise<Response> => {
    calls.push(url);
    const timeoutMs = timeoutOf(url);
    await clock.sleep(timeoutMs);
    const attempt = calls.filter(call => call === url).length;
    const body = INPUT_BODIES[url];
    if (body === undefined || attempt < ATTEMPTS) return timedOut();
    return new Response(body);
  };
}

/**
 * A prompt network: the inputs, a 404 at the newest browser layout, and a
 * body that is no Juggler schema everywhere else.
 *
 * @param url - Fetched URL.
 * @returns The response.
 */
function promptAnswer(url: string): Response {
  const status = url.includes('/browser/additions/') ? 404 : 200;
  return new Response(INPUT_BODIES[url] ?? 'not a schema', { status });
}

/**
 * Run the watch to completion on the virtual clock.
 *
 * @param clock - The virtual clock.
 * @param fetchImpl - The network.
 * @param overrides - Further watch I/O.
 * @returns What the run produced.
 */
async function watchOn(
  clock: IVirtualClock,
  fetchImpl: FetchImpl,
  overrides: IWatchIo = {},
): Promise<IRun> {
  const printed: IPrinted = { out: '', err: '', written: {} };
  const running = runWatch([], {
    ...writeInputs({
      manifestTag: SELECTED_TAG,
      lockfile: lockfileWith(LOCKED),
      packageJson: packageWith(RANGE),
    }),
    ...printingIo(printed),
    env: {},
    fetch: { fetchImpl, sleep: clock.sleep },
    /**
     * camoufox-js's check, faked.
     *
     * @returns The check.
     */
    assetCheck: (): Promise<IPlatformAssetCheck> => Promise.resolve(ASSET_CHECK),
    ...overrides,
  });
  const code = await clock.run(running);
  return { ...printed, code };
}

/**
 * The candidate table rows as `version tag`, in body order, with their verdicts.
 *
 * @param body - Issue body.
 * @returns One `[pair, compatible cell]` per row.
 */
function tableRows(body: string): [string, string][] {
  const rows = body.split('\n').filter(line => /^\| \d/u.test(line));
  return rows.map((line): [string, string] => {
    const cells = line.slice(2, -2).split(' | ');
    const [version] = cells[0].split(' ');
    return [`${version} ${cells[1].replaceAll('`', '')}`, cells[5]];
  });
}

/**
 * How many times each URL was fetched, in first-fetch order.
 *
 * @param urls - Every fetched URL.
 * @returns One count per distinct URL.
 */
function fetchCounts(urls: readonly string[]): number[] {
  const counts = new Map<string, number>();
  for (const url of urls) counts.set(url, (counts.get(url) ?? 0) + 1);
  return [...counts.values()];
}

/**
 * The `Protocol.js` URLs among `urls`.
 *
 * @param urls - Every fetched URL.
 * @returns Those on the gate's host.
 */
function protocolCalls(urls: readonly string[]): string[] {
  return urls.filter(url => url.startsWith(`https://${ALLOWED_HOST}/`));
}

/** A fake gate whose later pairs answer sooner, recording how many run at once. */
interface IStaggeredGate {
  readonly runGate: NonNullable<IWatchIo['runGate']>;
  readonly finished: string[];
  readonly inFlight: { now: number; peak: number };
}

/**
 * A fake gate on the virtual clock: the n-th pair started answers after
 * (pairs − n) seconds, compatible.
 *
 * @param clock - The virtual clock.
 * @returns The gate and what it recorded.
 */
function staggeredGate(clock: IVirtualClock): IStaggeredGate {
  const finished: string[] = [];
  const inFlight = { now: 0, peak: 0, started: 0 };
  /**
   * Answer one pair after its delay.
   *
   * @param args - Gate arguments.
   * @param io - Gate I/O.
   * @returns Exit 0.
   */
  const runGate = async (args: readonly string[], io: IGateIo): Promise<0> => {
    inFlight.now += 1;
    inFlight.peak = Math.max(inFlight.peak, inFlight.now);
    inFlight.started += 1;
    await clock.sleep((PAIRS.length - inFlight.started + 1) * 1000);
    inFlight.now -= 1;
    finished.push(`${args[1]} ${args[3]}`);
    io.stdout?.('{"exit":0,"new":[]}\n');
    return 0;
  };
  return { runGate, finished, inFlight };
}

describe('browser-stack watch bounds', () => {
  it('[WCB-1] reports every pair inside the job limit when every Protocol.js fetch times out', async () => {
    const clock = virtualClock();
    const calls: string[] = [];
    const network = slowestNetwork(clock, calls);
    const run = await watchOn(clock, network);
    const rows = tableRows(run.out);
    const verdicts = new Set(rows.map(([, verdict]) => verdict));
    const protocol = protocolCalls(calls);
    const counts = fetchCounts(protocol);
    const pairs = rows.map(([pair]) => pair);
    const everyAttempt = new Array<number>(PROTOCOL_URLS).fill(ATTEMPTS);
    const elapsedMs = clock.now();
    expect(run.code).toBe(0);
    expect(pairs).toEqual(PAIRS);
    expect([...verdicts]).toEqual(['unknown']);
    expect(counts).toEqual(everyAttempt);
    expect(elapsedMs).toBeGreaterThan(INPUTS_WORST_MS);
    expect(elapsedMs).toBeLessThanOrEqual(BOUND_MS);
    expect(BOUND_MS).toBeLessThanOrEqual(JOB_LIMIT_MS - SETUP_ALLOWANCE_MS);
  });

  it('[WCB-2] fetches each Protocol.js URL once per run, 404s included', async () => {
    const clock = virtualClock();
    const network = fakeFetch(promptAnswer);
    const run = await watchOn(clock, network.fetchImpl);
    const urls = network.calls.map(call => call.url);
    const protocol = protocolCalls(urls);
    const counts = fetchCounts(protocol);
    const distinct = VERSIONS.length + 2 * TAGS.length;
    const once = new Array<number>(distinct).fill(1);
    expect(run.code).toBe(0);
    expect(counts).toEqual(once);
  });

  it('[WCB-3] runs at most GATE_CONCURRENCY gates at once and keeps rows in pair order', async () => {
    const clock = virtualClock();
    const gate = staggeredGate(clock);
    const network = fakeFetch(promptAnswer);
    const run = await watchOn(clock, network.fetchImpl, { runGate: gate.runGate });
    const rows = tableRows(run.out);
    const pairs = rows.map(([pair]) => pair);
    expect(gate.inFlight.peak).toBe(GATE_CONCURRENCY);
    expect(gate.finished).not.toEqual(PAIRS);
    expect(pairs).toEqual(PAIRS);
  });
});
