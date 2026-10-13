/**
 * Unit test for the browser-stack gate CLI (`scripts/check-browser-stack.mjs`
 * and `scripts/browser-stack/{gate,gate-inputs,gate-pins,gate-report,fetch-protocol}.mjs`).
 *
 * <p>The gate is the PR check that the locked playwright-core can still drive
 * the pinned Camoufox over Juggler. Its verdict must be exact — NEW, STALE and
 * DRIFT, per mode — and a gate that cannot decide must never pass or fail as
 * if it had: every usage, manifest, lockfile, network or parse problem, and in
 * gate mode a Protocol.js that differs from its pinned sha256, exits 2. Each
 * run goes through `CheckBrowserStackHarness`, whose network is a fake
 * `fetch` routed by URL, so no case leaves the machine;
 * `npm run lint:browser-stack` checks the real upstream files.
 *
 * <p>Expected lines are written out literally rather than rebuilt from the
 * renderer, so a formatting change is a visible test change.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
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
  type IPins,
  type IScenario,
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
} from './CheckBrowserStackHarness.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const ENTRY = join(THIS_DIR, '../../../../scripts/check-browser-stack.mjs');

const CELLS = 'request UNKNOWN-FIELD          Network.setRequestInterception.bypassServiceWorker';
const NEW_LINE = `NEW       ${CELLS}  src:Optional(Boolean)|dst:absent`;
const STALE_LINE = `STALE     ${CELLS}  src:Optional(Boolean)|dst:absent`;
const DRIFT_LINE =
  'DRIFT     playwright-core minor 1.64 ≠ testedMinor 1.63' +
  ' (bump testedMinor only after the contract test passes)';
const GENERATED_LINE =
  'GENERATED-STALE src/Common/Config/BrowserStackConfig.ts differs from browser-stack.json' +
  ' (run npm run browser-stack:gen)';
const MODE_ERROR = 'USAGE --mode must be gate or candidate';
const USAGE_LINE =
  'usage: node scripts/check-browser-stack.mjs [--playwright <x.y.z>] [--camoufox <tag>]' +
  ' [--mode gate|candidate] [--json]';

afterEach(() => {
  removeGateRoots();
});

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
/** Pins for a run whose client is served {@link BROWSER}. */
const BROWSER_AS_CLIENT: IPins = { client: { '1.64.0': BROWSER_SHA }, browser: BROWSER_SHA };
const NO_CLIENT_PIN: IPins = { client: {}, browser: BROWSER_SHA };
const OTHER_SHA = 'e'.repeat(64);
const MOVED_CLIENT_PIN: IPins = { client: { '1.64.0': OTHER_SHA }, browser: BROWSER_SHA };
const UNPINNED_TEXT = 'browser-stack.json pins no Protocol.js sha256 [info]';
const UNPINNED_CLIENT = `UNPINNED  client playwright-core 1.64.0: ${UNPINNED_TEXT}`;
const MISMATCH_CLIENT =
  'MISMATCH  client playwright-core 1.64.0: Protocol.js sha256 differs from its pin [info]';

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
    scenario: { respond: serve(BROWSER), manifest: manifestOf([DELTA], '1.64', BROWSER_AS_CLIENT) },
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
    scenario: { respond: serve(BROWSER), manifest: manifestOf([DELTA], '1.63', BROWSER_AS_CLIENT) },
    code: 0,
    lines: [
      `${STALE_LINE} [info]`,
      `${DRIFT_LINE} [info]`,
      'PASS: 0 new, 1 stale, 0 accepted, drift',
    ],
  },
  {
    id: 'BSG-45',
    what: 'gate passes a playwright-core version with no Protocol.js pin, marked [info]',
    args: [],
    scenario: { manifest: manifestOf([DELTA], '1.64', NO_CLIENT_PIN) },
    code: 0,
    lines: [UNPINNED_CLIENT, 'PASS: 0 new, 0 stale, 1 accepted'],
  },
  {
    id: 'BSG-46',
    what: 'candidate reports a Protocol.js that differs from its pin, marked [info]',
    args: ['--mode', 'candidate'],
    scenario: { manifest: manifestOf([DELTA], '1.64', MOVED_CLIENT_PIN) },
    code: 0,
    lines: [MISMATCH_CLIENT, 'PASS: 0 new, 0 stale, 1 accepted'],
  },
  {
    id: 'BSG-14',
    what: 'gate fails a generated config that differs from the manifest',
    args: [],
    scenario: { generated: '// hand-edited\n' },
    code: 1,
    lines: [GENERATED_LINE, 'FAIL: 0 new, 0 stale, 1 accepted, generated stale'],
  },
  {
    id: 'BSG-15',
    what: 'candidate passes a stale generated config, marked [info]',
    args: ['--mode', 'candidate'],
    scenario: { generated: '' },
    code: 0,
    lines: [`${GENERATED_LINE} [info]`, 'PASS: 0 new, 0 stale, 1 accepted, generated stale'],
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
/** Outside the grammar: parsing it would fail as UNPARSEABLE. */
const UNPARSEABLE = `${IMPORT_LINE}\nexport const protocol = eval(1);`;
const UNPARSEABLE_SHA = sha256Of(UNPARSEABLE);
const UNPARSEABLE_BROWSER_PIN: IPins = { client: PINS.client, browser: UNPARSEABLE_SHA };
const MOVED_BROWSER = `${BROWSER}\n`;
const MOVED_BROWSER_SHA = sha256Of(MOVED_BROWSER);
const CLIENT_MISMATCH = `DIGEST-MISMATCH client playwright-core 1.64.0 sha256=${UNPARSEABLE_SHA} pinned=${CLIENT_SHA}`;
const BROWSER_MISMATCH = `DIGEST-MISMATCH browser Camoufox ${TAG} sha256=${MOVED_BROWSER_SHA} pinned=${BROWSER_SHA}`;

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
    id: 'BSG-43',
    what: 'a 429 on all 3 attempts',
    scenario: { client: statuses([429, 429, 429]) },
    err: `FETCH-FAILED ${CLIENT_URL} HTTP 429`,
    fetches: 4,
    sleeps: BACKOFF,
  },
  {
    id: 'BSG-44',
    what: 'a 403 is final',
    scenario: { client: statuses([403]) },
    err: `FETCH-FAILED ${CLIENT_URL} HTTP 403`,
    fetches: 2,
    sleeps: [],
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
    scenario: {
      respond: serve(CLIENT, UNPARSEABLE),
      manifest: manifestOf([DELTA], '1.64', UNPARSEABLE_BROWSER_PIN),
    },
    err: 'UNPARSEABLE browser line 2: expected an object literal',
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-47',
    what: 'a client Protocol.js that differs from its pin, before parsing it',
    scenario: { client: body(UNPARSEABLE) },
    err: `${CLIENT_MISMATCH}\n`,
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-48',
    what: 'a browser Protocol.js that differs from its pin',
    scenario: { respond: serve(CLIENT, MOVED_BROWSER) },
    err: `${BROWSER_MISMATCH}\n`,
    fetches: 2,
    sleeps: [],
  },
  {
    id: 'BSG-49',
    what: 'both Protocol.js files differing from their pins, one line each',
    scenario: { respond: serve(UNPARSEABLE, MOVED_BROWSER) },
    err: `${CLIENT_MISMATCH}\n${BROWSER_MISMATCH}\n`,
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
  {
    id: 'BSG-38',
    what: 'a 404 at every Camoufox layout, naming each URL tried',
    scenario: {
      respond: failing([
        [BROWSER_URL, 404],
        [LEGACY_URL, 404],
      ]),
    },
    err: `FETCH-FAILED ${BROWSER_URL} | ${LEGACY_URL} HTTP 404`,
    fetches: 3,
    sleeps: [],
  },
  {
    id: 'BSG-39',
    what: 'a 5xx at the newest layout, which never falls back to the legacy one',
    scenario: { respond: failing([[BROWSER_URL, 500]]) },
    err: `FETCH-FAILED ${BROWSER_URL} HTTP 500`,
    fetches: 4,
    sleeps: BACKOFF,
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
    const browser = `${RAW}/daijro/camoufox/v1.2.3-beta.4/browser/additions/${JUGGLER}`;
    expect(run.urls).toEqual([client, browser]);
    expect(run.out).toContain('playwright-core 1.65.2 × Camoufox v1.2.3-beta.4 (mode=gate)\n');
    expect(run.out).toContain(`UNPINNED  client playwright-core 1.65.2: ${UNPINNED_TEXT}\n`);
    expect(run.out).toContain(`UNPINNED  browser Camoufox v1.2.3-beta.4: ${UNPINNED_TEXT}\n`);
    expect(run.code).toBe(1);
  });

  it('[BSG-50] a pinned pair prints no pin rows', async () => {
    const run = await gate([]);
    expect(run.out).not.toMatch(/^(UNPINNED|MISMATCH) /mu);
  });
});

describe('browser-stack gate fetch policy', () => {
  it.each([503, 429])(
    '[BSG-10] recovers when a %i clears, after backing off 1 s then 2 s',
    async status => {
      const run = await gate([], { client: statuses([status, status]) });
      expect(run.code).toBe(0);
      expect(run.sleeps).toEqual(BACKOFF);
      const clientCalls = run.urls.filter((url): boolean => url === CLIENT_URL);
      expect(clientCalls).toHaveLength(3);
    },
  );

  it('[BSG-11] accepts a body of exactly the cap', async () => {
    const padded = CLIENT.padEnd(MAX_BODY_BYTES, ' ');
    const pins = { client: { '1.64.0': sha256Of(padded) }, browser: BROWSER_SHA };
    const manifest = manifestOf([DELTA], '1.64', pins);
    const run = await gate([], { client: body(padded), manifest });
    expect(run.code).toBe(0);
  });

  it('[BSG-12] follows a relative redirect that stays on the allowlist', async () => {
    const run = await gate([], { client: redirectTo('/microsoft/playwright/moved.js') });
    expect(run.code).toBe(0);
    expect(run.urls).toContain(`${RAW}/microsoft/playwright/moved.js`);
  });

  it('[BSG-13] falls back to the legacy Camoufox layout after a 404 on the newest', async () => {
    const run = await gate([], { respond: failing([[BROWSER_URL, 404]]) });
    expect(run.code).toBe(0);
    expect(run.urls).toEqual([CLIENT_URL, BROWSER_URL, LEGACY_URL]);
    expect(run.out).toContain(`browser sha256=${BROWSER_SHA}\n`);
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
      pins: { client: 'match', browser: 'match' },
      new: [],
      stale: [],
      accepted: [{ ...DELTA, reason: REASON }],
      drift: false,
      generatedStale: false,
      exit: 0,
    });
  });

  it.each([
    ['unpinned', ['--json'], NO_CLIENT_PIN],
    ['mismatch', ['--json', '--mode', 'candidate'], MOVED_CLIENT_PIN],
  ])('[BSG-51] --json reports the client pin as %s', async (state, args, pins) => {
    const manifest = manifestOf([DELTA], '1.64', pins);
    const run = await gate(args, { manifest });
    const report: unknown = JSON.parse(run.out);
    expect(report).toMatchObject({ pins: { client: state, browser: 'match' }, exit: 0 });
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
