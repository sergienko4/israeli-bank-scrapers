/**
 * Time and fetch bounds of the weekly browser-stack watch (`scripts/browser-stack/watch.mjs`).
 *
 * <p>The workflow gives the job `timeout-minutes`; the watch must write its
 * report within it even when upstream is at its slowest. Here the real gate
 * judges the consumer pair against a fake network on a virtual clock. In the
 * worst case each input answers on its last attempt at the edge of its
 * timeout (any later and the watch exits 2 without judging anything), and
 * every `Protocol.js` attempt times out — or the newest Camoufox layout
 * answers 404 only on its last attempt, so the gate falls back to the older
 * layout, whose attempts all time out. Elapsed time is simulated and the
 * bound is computed from the real timeout and back-off constants, never from
 * wall-clock time.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IPlatformAssetCheck } from '../../../../scripts/browser-stack/camoufox-releases.mjs';
import { RELEASES_URL } from '../../../../scripts/browser-stack/camoufox-releases.mjs';
import {
  ALLOWED_HOST,
  ATTEMPT_TIMEOUT_MS,
  BACKOFF_MS,
  protocolUrls,
} from '../../../../scripts/browser-stack/fetch-protocol.mjs';
import type { IFetchIo } from '../../../../scripts/browser-stack/gate.mjs';
import {
  PACKUMENT_TIMEOUT_MS,
  PACKUMENT_URL,
} from '../../../../scripts/browser-stack/playwright-versions.mjs';
import { runWatch } from '../../../../scripts/browser-stack/watch.mjs';
import {
  ASSET_CHECK,
  type IPrinted,
  packageWith,
  printingIo,
  RANGE,
  release,
  removeInputs,
  writeInputs,
} from '../../Helpers/BrowserStackWatchFixtures.js';
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

const IN_RANGE = '1.65.1';
const SELECTED_TAG = 'v152.0.4-beta.30';

/** A newer prerelease first, so the selected release is the second tag. */
const PAGE = [release('v156.0.1-beta.50', true), release(SELECTED_TAG)];

/** The consumer pair: the range's highest stable version × the selected release. */
const PAIR = `${IN_RANGE} ${SELECTED_TAG}`;

/** Browser layouts tried per tag, newest first; only a 404 moves on to the next. */
const BROWSER_ROOTS = protocolUrls(IN_RANGE, SELECTED_TAG).browser.length;

const PUBLISHED = ['1.63.1', '1.64.0', '1.64.2', '1.65.0', IN_RANGE, '2.0.0'];
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
 * The slowest browser schema: every layout but the last answers 404 at the edge of
 * its last attempt, and the last one times out on every attempt. The gate fetches
 * the client schema at the same time, and one client fetch is never slower.
 */
const BROWSER_WORST_MS = BROWSER_ROOTS * RELEASES_WORST_MS;

/** The one gate run starts once the inputs are read. */
const BOUND_MS = INPUTS_WORST_MS + BROWSER_WORST_MS;

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

/** What the last attempt at a URL gets: a response, or a thrown timeout. */
type LastAnswer = (url: string) => Response;

/**
 * Inputs answer; every `Protocol.js` URL times out.
 *
 * @param url - Fetched URL.
 * @returns The input's body; throws a timeout for any other URL.
 */
function inputsOnly(url: string): Response {
  const body = INPUT_BODIES[url];
  if (body === undefined) return timedOut();
  return new Response(body);
}

/**
 * As {@link inputsOnly}, but the newest browser layout answers 404, so the gate
 * falls back to the older one.
 *
 * @param url - Fetched URL.
 * @returns A 404 at the newest layout, else what {@link inputsOnly} answers.
 */
function newestLayoutGone(url: string): Response {
  if (url.includes('/browser/additions/')) return new Response('', { status: 404 });
  return inputsOnly(url);
}

/**
 * The slowest network: every attempt takes its whole timeout, and only the last
 * one may answer.
 *
 * @param clock - The virtual clock.
 * @param calls - Receives every fetched URL.
 * @param lastAnswer - What the last attempt at a URL gets.
 * @returns The fetch implementation.
 */
function slowestNetwork(
  clock: IVirtualClock,
  calls: string[],
  lastAnswer: LastAnswer = inputsOnly,
): FetchImpl {
  return async (url: string): Promise<Response> => {
    calls.push(url);
    const timeoutMs = timeoutOf(url);
    await clock.sleep(timeoutMs);
    const attempt = calls.filter(call => call === url).length;
    if (attempt < ATTEMPTS) return timedOut();
    return lastAnswer(url);
  };
}

/**
 * Run the watch to completion on the virtual clock.
 *
 * @param clock - The virtual clock.
 * @param fetchImpl - The network.
 * @returns What the run produced.
 */
async function watchOn(clock: IVirtualClock, fetchImpl: FetchImpl): Promise<IRun> {
  const printed: IPrinted = { out: '', err: '', written: {} };
  const running = runWatch([], {
    ...writeInputs({ manifestTag: SELECTED_TAG, packageJson: packageWith(RANGE) }),
    ...printingIo(printed),
    env: {},
    fetch: { fetchImpl, sleep: clock.sleep },
    /**
     * camoufox-js's check, faked.
     *
     * @returns The check.
     */
    assetCheck: (): Promise<IPlatformAssetCheck> => Promise.resolve(ASSET_CHECK),
  });
  const code = await clock.run(running);
  return { ...printed, code };
}

/**
 * The consumer pair as `version tag`, with its verdict.
 *
 * @param body - Issue body.
 * @returns `[pair, verdict]`, or empty strings when the body has no pair line.
 */
function consumerVerdict(body: string): [string, string] {
  const pattern = /^playwright-core `([^`]+)` .* × Camoufox `([^`]+)` .*: \*\*([^*]+)\*\*/mu;
  const [, version = '', tag = '', verdict = ''] = pattern.exec(body) ?? [];
  return [`${version} ${tag}`, verdict];
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

const UNKNOWN = 'unknown (the gate could not decide)';

describe('browser-stack watch bounds', () => {
  it('[WCB-1] reports the consumer pair inside the job limit when every Protocol.js fetch times out', async () => {
    const clock = virtualClock();
    const calls: string[] = [];
    const network = slowestNetwork(clock, calls);
    const run = await watchOn(clock, network);
    const protocol = protocolCalls(calls);
    const counts = fetchCounts(protocol);
    const judged = consumerVerdict(run.out);
    const elapsedMs = clock.now();
    expect(run.code).toBe(0);
    expect(judged).toEqual([PAIR, UNKNOWN]);
    expect(counts).toEqual([ATTEMPTS, ATTEMPTS]);
    expect(elapsedMs).toBeGreaterThan(INPUTS_WORST_MS);
    expect(elapsedMs).toBeLessThanOrEqual(BOUND_MS);
    expect(BOUND_MS).toBeLessThanOrEqual(JOB_LIMIT_MS - SETUP_ALLOWANCE_MS);
  });

  it('[WCB-2] reaches the bound, inside the job limit, when the newest layout 404s late and the fallback times out', async () => {
    const clock = virtualClock();
    const calls: string[] = [];
    const network = slowestNetwork(clock, calls, newestLayoutGone);
    const run = await watchOn(clock, network);
    const protocol = protocolCalls(calls);
    const counts = fetchCounts(protocol);
    const judged = consumerVerdict(run.out);
    const everyAttempt = new Array<number>(1 + BROWSER_ROOTS).fill(ATTEMPTS);
    const elapsedMs = clock.now();
    expect(run.code).toBe(0);
    expect(judged).toEqual([PAIR, UNKNOWN]);
    expect(counts).toEqual(everyAttempt);
    expect(elapsedMs).toBe(BOUND_MS);
    expect(BOUND_MS).toBeLessThanOrEqual(JOB_LIMIT_MS - SETUP_ALLOWANCE_MS);
  });
});
