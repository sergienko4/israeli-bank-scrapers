/**
 * Unit tests for the weekly browser-stack watch (`scripts/browser-stack/watch.mjs`).
 *
 * <p>The network is a fake `fetch` serving a releases page and a packument,
 * camoufox-js's asset check is a fake for `lin x86_64`, and the gate is a
 * fake `runGate` that records its arguments and answers per pair. So each
 * case pins one part of the contract: which pairs run, in which mode, and
 * how the body reports the consumer pair, CI drift, the candidate table and
 * input failures. The library's playwright-core range is a package.json
 * fixture, so the consumer pair follows the range, not npm `latest`.
 */

import type {
  IPlatformAssetCheck,
  IRelease,
} from '../../../../scripts/browser-stack/camoufox-releases.mjs';
import { RELEASES_URL } from '../../../../scripts/browser-stack/camoufox-releases.mjs';
import type { IGateIo } from '../../../../scripts/browser-stack/gate.mjs';
import { PACKUMENT_URL } from '../../../../scripts/browser-stack/playwright-versions.mjs';
import { runWatch } from '../../../../scripts/browser-stack/watch.mjs';
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
import { fakeFetch, type IFetchFake } from '../../Helpers/FakeFetch.js';

const LOCKED = '1.63.1';
const NEXT = '1.64.2';
const STABLE_TAG = 'v156.0.1-beta.35';
const PRE_TAG = 'v156.0.1-beta.38';
const OLD_TAG = 'v152.0.4-beta.30';
const REPO = 'owner/repo';

/** The gate's JSON report for one pair: its exit code and what it prints. */
interface IGateOutcome {
  readonly exit: 0 | 1 | 2;
  readonly report: object;
}

const COMPATIBLE: IGateOutcome = { exit: 0, report: { exit: 0, new: [] } };

/**
 * A gate outcome with NEW deltas at `paths`.
 *
 * @param paths - Delta paths.
 * @returns The outcome.
 */
function incompatible(...paths: string[]): IGateOutcome {
  const deltas = paths.map(path => ({ channel: 'request', kind: 'UNKNOWN-FIELD', path }));
  return { exit: 1, report: { exit: 1, new: deltas } };
}

const UNDECIDED: IGateOutcome = {
  exit: 2,
  report: { exit: 2, errors: ['FETCH-FAILED https://x HTTP 503'] },
};

const PAGE = [release(PRE_TAG, true), release(STABLE_TAG), release(OLD_TAG)];

/** Published playwright-core versions: two stable lines and a prerelease. */
const PUBLISHED = [LOCKED, '1.64.0', NEXT, '1.65.0-alpha-1'];

/** What one scenario changes from the default upstream state. */
interface IScenario {
  readonly page?: readonly IRelease[];
  readonly manifestTag?: string;
  readonly lockfile?: string;
  readonly packageJson?: string;
  readonly published?: readonly string[];
  readonly latest?: string;
  readonly releasesStatus?: number;
  readonly outcomes?: Readonly<Record<string, IGateOutcome>>;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** What one run captured. */
interface ICapture extends IPrinted {
  readonly gateArgs: (readonly string[])[];
  readonly gateIo: IGateIo[];
}

/** What one run produced. */
interface IRun extends ICapture {
  readonly code: 0 | 2;
  /** Every URL the watch itself fetched (the fake gate fetches nothing). */
  readonly fetched: readonly string[];
}

/** The recording fetch and the back-off it skips. */
type UpstreamFetch = IFetchFake & { readonly sleep: () => Promise<number> };

afterAll(() => {
  removeInputs();
});

/**
 * The packument: `published`, with `latest` on the next line by default.
 *
 * @param scenario - Upstream state.
 * @returns Packument JSON.
 */
function packumentBody(scenario: IScenario): string {
  const published = scenario.published ?? PUBLISHED;
  const entries = published.map((version): [string, object] => [version, {}]);
  const versions = Object.fromEntries(entries);
  return JSON.stringify({ 'dist-tags': { latest: scenario.latest ?? NEXT }, versions });
}

/**
 * Serve the releases page and the packument.
 *
 * @param scenario - Upstream state.
 * @returns The fetch I/O.
 */
function upstream(scenario: IScenario): UpstreamFetch {
  const page = JSON.stringify(scenario.page ?? PAGE);
  const packument = packumentBody(scenario);
  /**
   * Answer one upstream URL.
   *
   * @param url - Fetched URL.
   * @returns The releases page, the packument, or an empty 200.
   */
  const reply = (url: string): Response => {
    const isReleases = url === RELEASES_URL;
    const status = isReleases ? (scenario.releasesStatus ?? 200) : 200;
    const body = isReleases ? page : packument;
    return new Response(url === PACKUMENT_URL || isReleases ? body : '', { status });
  };
  const fake = fakeFetch(reply);
  /**
   * Skip retry back-off.
   *
   * @returns Resolved at once.
   */
  const sleep = (): Promise<number> => Promise.resolve(0);
  return { ...fake, sleep };
}

/**
 * Write the scenario's manifest, lockfile and package.json.
 *
 * @param scenario - What differs from the default.
 * @returns The three paths.
 */
function inputsOf(scenario: IScenario): ReturnType<typeof writeInputs> {
  return writeInputs({
    manifestTag: scenario.manifestTag ?? STABLE_TAG,
    lockfile: scenario.lockfile ?? lockfileWith(LOCKED),
    packageJson: scenario.packageJson ?? packageWith(RANGE),
  });
}

/**
 * Run the watch against one scenario.
 *
 * @param scenario - What differs from the default.
 * @returns What the run produced.
 */
async function watch(scenario: IScenario = {}): Promise<IRun> {
  const run: ICapture = { out: '', err: '', gateArgs: [], gateIo: [], written: {} };
  const outcomes = scenario.outcomes ?? {};
  const fetchIo = upstream(scenario);
  const code = await runWatch(scenario.args ?? [], {
    ...inputsOf(scenario),
    ...printingIo(run),
    env: scenario.env ?? {},
    fetch: fetchIo,
    /**
     * camoufox-js's check, faked.
     *
     * @returns The check.
     */
    assetCheck: (): Promise<IPlatformAssetCheck> => Promise.resolve(ASSET_CHECK),
    /**
     * Record the gate call and answer for its pair.
     *
     * @param args - Gate arguments.
     * @param io - Gate I/O.
     * @returns The pair's exit code.
     */
    runGate: (args: readonly string[], io: IGateIo): Promise<0 | 1 | 2> => {
      run.gateArgs.push(args);
      run.gateIo.push(io);
      const outcome = outcomes[`${args[1]} ${args[3]}`] ?? COMPATIBLE;
      io.stdout?.(`${JSON.stringify(outcome.report)}\n`);
      return Promise.resolve(outcome.exit);
    },
  });
  const fetched = fetchIo.calls.map(call => call.url);
  return { ...run, code, fetched };
}

/**
 * The candidate table row for one pair, split into cells.
 *
 * @param body - Issue body.
 * @param playwright - playwright-core version.
 * @param tag - Camoufox tag.
 * @returns Cells, without the outer pipes.
 */
function rowOf(body: string, playwright: string, tag: string): string[] {
  const lines = body.split('\n');
  const line = lines.find(l => l.startsWith(`| ${playwright} `) && l.includes(`\`${tag}\``)) ?? '';
  return line.split(' | ').map(cell => cell.replace(/^\| | \|$/gu, ''));
}

describe('browser-stack watch report', () => {
  it('[WCH-1] runs the gate in candidate mode on every version × release', async () => {
    const run = await watch();
    const pairs = run.gateArgs.map(args => `${args[1]} ${args[3]}`);
    expect(run.code).toBe(0);
    expect(pairs).toEqual([
      `${LOCKED} ${PRE_TAG}`,
      `${LOCKED} ${STABLE_TAG}`,
      `${LOCKED} ${OLD_TAG}`,
      `${NEXT} ${PRE_TAG}`,
      `${NEXT} ${STABLE_TAG}`,
      `${NEXT} ${OLD_TAG}`,
    ]);
    for (const args of run.gateArgs)
      expect(args).toEqual([...args.slice(0, 4), '--mode', 'candidate', '--json']);
  });

  it('[WCH-2] hands the gate the same manifest, lockfile and fetch I/O', async () => {
    const run = await watch();
    const [first] = run.gateIo;
    expect(first.manifestPath).toMatch(/browser-stack\.json$/u);
    expect(first.lockfilePath).toMatch(/package-lock\.json$/u);
    expect(first.fetch?.fetchImpl).toBeDefined();
  });

  it('[WCH-3] reports the consumer pair (range × selected) with its NEW paths', async () => {
    const outcomes = {
      [`${NEXT} ${STABLE_TAG}`]: incompatible('Network.setRequestInterception.bypassServiceWorker'),
    };
    const run = await watch({ outcomes });
    expect(run.out).toContain(
      `playwright-core \`${NEXT}\` (what a consumer's \`${RANGE}\` resolves to) × Camoufox \`${STABLE_TAG}\` (what camoufox-js installs): **not compatible** — NEW: \`Network.setRequestInterception.bypassServiceWorker\`.`,
    );
  });

  it('[WCH-4] marks selected-compatible only on a compatible, selected pair', async () => {
    const outcomes = { [`${NEXT} ${STABLE_TAG}`]: incompatible('A.b') };
    const run = await watch({ outcomes });
    const selectedOk = rowOf(run.out, LOCKED, STABLE_TAG);
    const prereleaseOk = rowOf(run.out, LOCKED, PRE_TAG);
    const selectedNew = rowOf(run.out, NEXT, STABLE_TAG);
    const selectedOkFlags = selectedOk.slice(2);
    const prereleaseOkFlags = prereleaseOk.slice(2);
    const selectedNewFlags = selectedNew.slice(2);
    expect(selectedOkFlags).toEqual(['no', 'yes', '0', 'yes', 'yes']);
    expect(prereleaseOkFlags).toEqual(['yes', 'no', '0', 'yes', 'no']);
    expect(selectedNewFlags).toEqual(['no', 'yes', '1: `A.b`', 'no', 'no']);
    expect(selectedNew[0]).toBe(`${NEXT} (next minor 1.64, range ${RANGE})`);
  });

  it('[WCH-5] reports CI drift when the manifest tag is not the selected release', async () => {
    const inStep = await watch();
    const drifted = await watch({ manifestTag: OLD_TAG });
    expect(inStep.out).toContain(`camoufox-js installs \`${STABLE_TAG}\`: **in step**.`);
    expect(drifted.out).toContain(
      `CI installs Camoufox \`${OLD_TAG}\` (\`browser-stack.json\`); camoufox-js installs \`${STABLE_TAG}\`: **drift**.`,
    );
  });

  it('[WCH-6] says a consumer install fails when no stable release has an asset', async () => {
    const run = await watch({ page: [release(PRE_TAG, true)] });
    expect(run.out).toContain('camoufox-js finds no stable release with a lin x86_64 asset');
    expect(run.out).toContain('camoufox-js installs none: **drift**.');
    expect(run.gateArgs).toHaveLength(2);
  });

  it('[WCH-7] still runs the selected release when it is older than the newest ten', async () => {
    const prereleases = Array.from({ length: 10 }, (_, i) =>
      release(`v156.0.1-beta.${String(50 - i)}`, true),
    );
    const run = await watch({ page: [...prereleases, release(OLD_TAG)] });
    const tags = run.gateArgs.map(args => args[3]);
    expect(tags).toContain(OLD_TAG);
    expect(run.out).toContain(`playwright-core \`${NEXT}\``);
    expect(rowOf(run.out, NEXT, OLD_TAG)[3]).toBe('yes');
  });

  it('[WCH-8] lists a pair the gate cannot decide as unknown, with its errors, and exits 0', async () => {
    const run = await watch({ outcomes: { [`${LOCKED} ${OLD_TAG}`]: UNDECIDED } });
    expect(run.code).toBe(0);
    const row = rowOf(run.out, LOCKED, OLD_TAG);
    const verdictCells = row.slice(4);
    expect(verdictCells).toEqual(['—', 'unknown', 'no']);
    expect(run.out).toContain(`- ${LOCKED} × \`${OLD_TAG}\`: FETCH-FAILED https://x HTTP 503`);
  });

  it('[WCH-9] shows three NEW paths, then how many more', async () => {
    const outcomes = { [`${LOCKED} ${OLD_TAG}`]: incompatible('A.a', 'A.b', 'A.c', 'A.d', 'A.e') };
    const run = await watch({ outcomes });
    expect(rowOf(run.out, LOCKED, OLD_TAG)[4]).toBe('5: `A.a`, `A.b`, `A.c`, 2 more');
  });

  it('[WCH-10] writes the printed body to --out and links open updates in a repository', async () => {
    const run = await watch({ args: ['--out', '/tmp/body.md'], env: { GITHUB_REPOSITORY: REPO } });
    const local = await watch();
    expect(run.written['/tmp/body.md']).toBe(run.out);
    expect(run.out).toContain(
      `https://github.com/${REPO}/pulls?q=is%3Apr+is%3Aopen+playwright-core`,
    );
    expect(local.out).not.toContain('https://github.com/');
  });
});

describe('browser-stack watch input failures', () => {
  it('[WCH-11] exits 2 with FETCH-FAILED and runs no gate when the releases page fails', async () => {
    const run = await watch({ releasesStatus: 404 });
    expect(run.code).toBe(2);
    expect(run.err).toBe(`FETCH-FAILED ${RELEASES_URL} HTTP 404\n`);
    expect(run.out).toBe('');
    expect(run.gateArgs).toHaveLength(0);
  });

  it('[WCH-12] exits 2 on an unreadable lockfile', async () => {
    const run = await watch({ lockfile: '{' });
    expect(run.code).toBe(2);
    expect(run.err).toMatch(/^LOCKFILE-INVALID /u);
  });

  it('[WCH-13] exits 2 on an unknown argument', async () => {
    const run = await watch({ args: ['--bogus'] });
    expect(run.code).toBe(2);
    expect(run.err).toMatch(/^USAGE /u);
  });

  it('[WCH-14] exits 2 with RANGE-UNSUPPORTED before any fetch or gate on a non-caret range', async () => {
    const packageJson = packageWith('~1.62.0');
    const run = await watch({ packageJson });
    expect(run.code).toBe(2);
    expect(run.err).toBe('RANGE-UNSUPPORTED ~1.62.0\n');
    expect(run.out).toBe('');
    expect(run.fetched).toEqual([]);
    expect(run.gateArgs).toHaveLength(0);
  });

  it('[WCH-15] exits 2 with PACKAGE-INVALID when package.json declares no playwright-core', async () => {
    const run = await watch({ packageJson: '{}' });
    expect(run.code).toBe(2);
    expect(run.err).toMatch(
      /^PACKAGE-INVALID .*dependencies\["playwright-core"\] is not a string\n$/u,
    );
    expect(run.gateArgs).toHaveLength(0);
  });
});

describe('browser-stack watch consumer range', () => {
  it('[WCH-16] pairs the highest stable version in range when latest is a new major', async () => {
    const inRange = '1.65.1';
    const published = [...PUBLISHED, '1.65.0', inRange, '2.0.0'];
    const run = await watch({ published, latest: '2.0.0' });
    const versions = run.gateArgs.map(args => args[1]);
    const distinct = new Set(versions);
    expect([...distinct]).toEqual([LOCKED, NEXT, inRange]);
    expect(run.out).toContain(
      `playwright-core \`${inRange}\` (what a consumer's \`${RANGE}\` resolves to) × Camoufox \`${STABLE_TAG}\``,
    );
    expect(rowOf(run.out, inRange, STABLE_TAG)[0]).toBe(`${inRange} (range ${RANGE})`);
  });

  it('[WCH-17] says so when no stable version satisfies the range', async () => {
    const packageJson = packageWith('^3.0.0');
    const run = await watch({ packageJson });
    expect(run.code).toBe(0);
    expect(run.out).toContain(
      `No stable playwright-core version satisfies \`^3.0.0\` to pair with \`${STABLE_TAG}\`.`,
    );
  });
});
