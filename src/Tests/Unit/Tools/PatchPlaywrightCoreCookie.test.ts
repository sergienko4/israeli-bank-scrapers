/**
 * Unit test for the Set-Cookie split of `scripts/patch-playwright-core.mjs`.
 *
 * <p>Camoufox's Juggler reports every `Set-Cookie` of a response as one header
 * whose value joins the cookies with newlines. playwright-core 1.63 split that
 * value itself; 1.64 expects one field per header, as upstream Firefox now
 * sends, and passes the joined value through, so `headersArray()` returns one
 * entry for several cookies. The patcher restores the split at the Firefox
 * network manager's response site, for `Set-Cookie` only: every other header
 * keeps the value Juggler sent, as 1.64 intends. `--strict` proves the review
 * still holds: exactly one response site, built in a known form — 1.63's own
 * split or the patched 1.64 one.
 *
 * <p>Every case runs the real script against a synthetic bundle whose response
 * site is upstream's text, so a fixture cannot drift from what the patcher
 * meets in a real install.
 */

import { runInNewContext } from 'node:vm';

import {
  atBothSites,
  bundleOf,
  COOKIE_CLEAN,
  COOKIE_PREFIX,
  GUARDED,
  linesOf,
  mtimeOf,
  patchedBundleOf,
  PREFIX,
  readBundle,
  removeRoots,
  RESPONSE_163,
  RESPONSE_164,
  RESPONSE_SPLIT,
  responseOf,
  runPatcher,
  sandboxWithBundle,
  SENT_163,
  SHIM_PREFIX,
  UNTOUCHED_MS,
} from '../../Helpers/PatchPlaywrightCoreSandbox.js';

const GUARD_CLEAN = 'already guarded';
const SHIM_CLEAN = 'no bypassServiceWorker sent';
const COOKIE_SPLIT = 'split Set-Cookie at 1 response site(s)';
const COOKIE_TAG = 'COOKIE-SITES';

/** Response sites in the reviewed playwright-core: the Firefox network manager's one. */
const REVIEWED_RESPONSES = 1;

/** The arguments after the header list, which locate a response site in any reviewed build. */
const RESPONSE_SITE = 'timing, getResponseBody, event.fromServiceWorker';

/** A header list the split does not know: a future build splitting in a form of its own. */
const RESPONSE_UNKNOWN = responseOf('splitSetCookieHeader(event.headers)');

/** A 1.64 response whose later arguments changed: the rewrite cannot read it, the count still sees it. */
const RESPONSE_RETAILED = RESPONSE_164.replace('event.fromServiceWorker)', 'false)');

/** 1.64's header-list text outside any response build: never rewritten, never counted. */
const STRAY_TAIL = `report(event.statusText, event.headers, ${RESPONSE_SITE})`;

/** 1.64 responses the exact rewrite cannot read but the count still sees. */
const RESPONSE_STATUS_FALLBACK = RESPONSE_164.replace(
  'event.statusText,',
  'event.statusText || "",',
);
const RESPONSE_WRAPPED = RESPONSE_164.replace('event.status, ', 'event.status,\n          ');
const RESPONSE_NESTED = RESPONSE_164.replace(
  'request2.request',
  'resolveRequest(request2, event.requestId)',
);
const RESPONSE_QUALIFIED = RESPONSE_164.replace('new Response2(', 'new import_network.Response(');

/** Both pageError sites guarded and the 1.63 send, so only the response varies. */
const GUARDED_SITES = atBothSites(GUARDED);
const CALLS = [SENT_163];

/** Juggler's headers for one response, as Camoufox reports them: cookies joined by a line break. */
const JUGGLER_HEADERS = [
  { name: 'Set-Cookie', value: 'a=1; Path=/\r\n b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT' },
  { name: 'Vary', value: 'Accept, Origin' },
  { name: 'set-cookie', value: 'c=3' },
];

/** Set-Cookie split and trimmed as 1.63 split it, one per cookie; other headers as sent. */
const SPLIT_HEADERS = [
  { name: 'Set-Cookie', value: 'a=1; Path=/' },
  { name: 'Set-Cookie', value: 'b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT' },
  { name: 'Vary', value: 'Accept, Origin' },
  { name: 'set-cookie', value: 'c=3' },
];

/** A guarded bundle's response sites, the split outcome, and the lines `--strict` adds. */
interface ICookieCase {
  readonly id: string;
  readonly what: string;
  readonly responses: readonly string[];
  readonly outcome: string;
  readonly strict: readonly string[];
}

/** Stands in for playwright-core's Firefox `Response`, keeping the header list it was built with. */
class BuiltResponse {
  public readonly headers: unknown;

  /**
   * Keep the header list.
   *
   * @param args - The response constructor's arguments; the fourth is the header list.
   */
  constructor(...args: readonly unknown[]) {
    this.headers = args[3];
  }
}

/** The Juggler event and locals a response site reads, with `Response` stood in for. */
const RESPONSE_SCOPE = {
  Response2: BuiltResponse,
  request2: { request: {} },
  event: { status: 200, statusText: 'OK', headers: JUGGLER_HEADERS, fromServiceWorker: false },
  timing: {},
  getResponseBody: null,
};

/**
 * The `COOKIE-SITES` line `--strict` prints when the response sites differ from the review.
 *
 * @param known - Sites that split Set-Cookie in a known form after patching.
 * @param sites - All response sites after patching.
 * @returns Expected line.
 */
function cookieLine(known: number, sites: number): string {
  const counts = `${String(known)}/${String(REVIEWED_RESPONSES)} (${String(sites)} sites)`;
  return `${COOKIE_TAG} ${counts} ${RESPONSE_SITE}`;
}

/**
 * The split outcome when some response site is in no known form.
 *
 * @param known - Sites that split Set-Cookie in a known form after patching.
 * @param sites - All response sites after patching.
 * @returns Expected outcome text.
 */
function cookieNotApplied(known: number, sites: number): string {
  return `NOT APPLIED — ${String(known)} of ${String(sites)} response site(s) in a known form`;
}

/**
 * The header list one response site of a bundle hands to `Response`.
 *
 * @param bundle - Bundle text holding exactly one response site.
 * @returns The headers, copied out of the evaluation context.
 */
function headersBuilt(bundle: string): unknown {
  const site = bundle.split('\n').find((line): boolean => line.startsWith('const response2 = '));
  const scope = { ...RESPONSE_SCOPE };
  const built: unknown = runInNewContext(`${site ?? ''}\nresponse2.headers`, scope);
  const copied = JSON.stringify(built);
  return JSON.parse(copied) as unknown;
}

const COOKIE_CASES: readonly ICookieCase[] = [
  {
    id: 'PPC-70',
    what: 'a 1.63 response, which splits Set-Cookie itself',
    responses: [RESPONSE_163],
    outcome: COOKIE_CLEAN,
    strict: [],
  },
  {
    id: 'PPC-71',
    what: 'a 1.64 response passing Set-Cookie through',
    responses: [RESPONSE_164],
    outcome: COOKIE_SPLIT,
    strict: [],
  },
  {
    id: 'PPC-72',
    what: 'a response already split',
    responses: [RESPONSE_SPLIT],
    outcome: COOKIE_CLEAN,
    strict: [],
  },
  {
    id: 'PPC-73',
    what: 'a header list the split does not know',
    responses: [RESPONSE_UNKNOWN],
    outcome: cookieNotApplied(0, 1),
    strict: [cookieLine(0, 1)],
  },
  {
    id: 'PPC-74',
    what: 'no response site at all',
    responses: [],
    outcome: cookieNotApplied(0, 0),
    strict: [cookieLine(0, 0)],
  },
  {
    id: 'PPC-75',
    what: 'a second 1.64 response the review never saw',
    responses: [RESPONSE_164, RESPONSE_164],
    outcome: 'split Set-Cookie at 2 response site(s)',
    strict: [cookieLine(2, 2)],
  },
  {
    id: 'PPC-76',
    what: 'a 1.64 response beside an unknown one',
    responses: [RESPONSE_164, RESPONSE_UNKNOWN],
    outcome: COOKIE_SPLIT,
    strict: [cookieLine(1, 2)],
  },
  {
    id: 'PPC-77',
    what: 'a 1.63 response beside an unknown one',
    responses: [RESPONSE_163, RESPONSE_UNKNOWN],
    outcome: cookieNotApplied(1, 2),
    strict: [cookieLine(1, 2)],
  },
  {
    id: 'PPC-81',
    what: 'a 1.64 response beside one whose later arguments changed',
    responses: [RESPONSE_164, RESPONSE_RETAILED],
    outcome: COOKIE_SPLIT,
    strict: [cookieLine(1, 2)],
  },
  {
    id: 'PPC-82',
    what: "an unknown response beside 1.64's header list outside a response",
    responses: [RESPONSE_UNKNOWN, STRAY_TAIL],
    outcome: cookieNotApplied(0, 1),
    strict: [cookieLine(0, 1)],
  },
  {
    id: 'PPC-83',
    what: 'a 1.64 response beside one with a status-text fallback',
    responses: [RESPONSE_164, RESPONSE_STATUS_FALLBACK],
    outcome: COOKIE_SPLIT,
    strict: [cookieLine(1, 2)],
  },
  {
    id: 'PPC-84',
    what: 'a 1.64 response beside one wrapped onto a new line',
    responses: [RESPONSE_164, RESPONSE_WRAPPED],
    outcome: COOKIE_SPLIT,
    strict: [cookieLine(1, 2)],
  },
  {
    id: 'PPC-85',
    what: 'a 1.64 response beside one whose first argument holds a comma',
    responses: [RESPONSE_164, RESPONSE_NESTED],
    outcome: COOKIE_SPLIT,
    strict: [cookieLine(1, 2)],
  },
  {
    id: 'PPC-91',
    what: 'a 1.64 response beside one built through a qualified constructor',
    responses: [RESPONSE_164, RESPONSE_QUALIFIED],
    outcome: COOKIE_SPLIT,
    strict: [cookieLine(1, 2)],
  },
];

afterEach(() => {
  removeRoots();
});

describe('patch-playwright-core Set-Cookie split', () => {
  it.each(COOKIE_CASES)('[$id] $what → exit 0, "$outcome", no COOKIE-SITES', cookieCase => {
    const sandbox = sandboxWithBundle(GUARDED_SITES, CALLS, cookieCase.responses);
    const run = runPatcher(sandbox, []);
    const lines = [
      PREFIX + GUARD_CLEAN,
      SHIM_PREFIX + SHIM_CLEAN,
      COOKIE_PREFIX + cookieCase.outcome,
    ];
    expect(run).toEqual({ status: 0, stdout: linesOf(lines), stderr: '' });
  });

  it.each(COOKIE_CASES)(
    '[$id] $what → --strict exits 1 iff the response sites differ from the review, named once',
    cookieCase => {
      const sandbox = sandboxWithBundle(GUARDED_SITES, CALLS, cookieCase.responses);
      const run = runPatcher(sandbox, ['--strict']);
      const reported = [PREFIX + GUARD_CLEAN, SHIM_PREFIX + SHIM_CLEAN];
      const lines = [...reported, COOKIE_PREFIX + cookieCase.outcome, ...cookieCase.strict];
      const status = cookieCase.strict.length > 0 ? 1 : 0;
      expect(run).toEqual({ status, stdout: linesOf(lines), stderr: '' });
    },
  );

  it.each(COOKIE_CASES)('[$id] $what → only 1.64 responses are rewritten', cookieCase => {
    const sandbox = sandboxWithBundle(GUARDED_SITES, CALLS, cookieCase.responses);
    runPatcher(sandbox, ['--strict']);
    const text = readBundle(sandbox);
    const expected = patchedBundleOf(GUARDED_SITES, CALLS, cookieCase.responses);
    expect(text).toBe(expected);
  });

  it.each([
    ['a 1.63 response', RESPONSE_163],
    ['an unknown response', RESPONSE_UNKNOWN],
  ])('[PPC-78] never writes when no response needs the split (%s)', (_what, response) => {
    const sandbox = sandboxWithBundle(GUARDED_SITES, CALLS, [response]);
    runPatcher(sandbox, []);
    const mtime = mtimeOf(sandbox.bundle);
    expect(mtime).toBe(UNTOUCHED_MS);
  });

  it('[PPC-79] an unpatched 1.64 response keeps the cookies joined in one header', () => {
    const bundle = bundleOf(GUARDED_SITES, CALLS, [RESPONSE_164]);
    const headers = headersBuilt(bundle);
    expect(headers).toEqual(JUGGLER_HEADERS);
  });

  it('[PPC-80] a patched 1.64 response splits Set-Cookie per trimmed line, others as sent', () => {
    const sandbox = sandboxWithBundle(GUARDED_SITES, CALLS, [RESPONSE_164]);
    runPatcher(sandbox, []);
    const text = readBundle(sandbox);
    const headers = headersBuilt(text);
    expect(headers).toEqual(SPLIT_HEADERS);
  });
});
