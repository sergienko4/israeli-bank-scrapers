/**
 * Unit test for `scripts/browser-stack/manifest.mjs` and the real
 * `browser-stack.json`.
 *
 * <p>The manifest is the single source of the tested browser stack: the
 * install-camoufox action and the Docker CI mirror read the pinned Camoufox
 * tag and its asset SHA-256 through this validator, and later the Juggler
 * gate reads the accepted deltas from it. A malformed value must therefore
 * fail closed — nothing printed, exit 2 — rather than install an unpinned,
 * mistyped or unverified browser.
 *
 * <p>Every invalid variant below is paired with positive controls, so a rule
 * that is merely too strict (and would reject a legitimate future bump) fails
 * here as surely as one that is too lax. Variants are data — a JSON pointer
 * and the value written there — so the table cannot hide logic of its own.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadManifest, validateManifest } from '../../../../scripts/browser-stack/manifest.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../../');
const CLI = join(REPO_ROOT, 'scripts/browser-stack/manifest.mjs');
const REAL_MANIFEST = join(REPO_ROOT, 'browser-stack.json');
const MISSING_MANIFEST = join(REPO_ROOT, 'no-such-browser-stack.json');

/** Matches the Camoufox release tag shape the CI cache key is built from. */
const CAMOUFOX_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(alpha|beta)\.(0|[1-9]\d*)$/u;

/** Matches the bare lowercase-hex SHA-256 install.sh compares the asset with. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/**
 * A well-formed tag that is deliberately NOT the pinned one, so the live tag
 * stays a single literal in browser-stack.json.
 */
const SAMPLE_TAG = 'v100.0.0-beta.1';
/** A well-formed digest, likewise NOT the pinned one. */
const SAMPLE_SHA256 = 'ab'.repeat(32);
const SHA_AT = '/camoufox/linuxX64Sha256';

/** Written at a pointer to delete the key instead of overwriting it. */
const REMOVE = Symbol('remove');

/** The one accepted delta of the valid baseline. */
const BASE_DELTA = {
  channel: 'request',
  kind: 'TYPE-MISMATCH',
  path: 'Browser.setHTTPCredentials.credentials',
  signature: 'src:Array(Object)|dst:{origin,password,username}',
  reason: '0 uses of httpCredentials in src',
} as const;

/** One edit to the baseline: the value written at a JSON pointer of plain keys. */
interface IEdit {
  readonly what: string;
  readonly at: string;
  readonly value: unknown;
}

/** An invalid edit and the single pointer the validator must report for it. */
interface IInvalidCase extends IEdit {
  readonly id: string;
  readonly pointer: string;
}

/**
 * A fully valid manifest carrying one accepted delta.
 *
 * @returns A fresh document the caller may edit.
 */
function validDoc(): Record<string, unknown> {
  const meta = { $comment: 'Tested browser stack.', acceptedDeltas: [{ ...BASE_DELTA }] };
  const camoufox = { tag: SAMPLE_TAG, linuxX64Sha256: SAMPLE_SHA256 };
  return { ...meta, camoufox, playwrightCore: { testedMinor: '1.63' } };
}

/**
 * Apply one edit to a fresh valid document and validate it.
 *
 * @param edit - Pointer and value to write (or {@link REMOVE}).
 * @returns The pointers of every finding.
 */
function pointersAfter(edit: IEdit): readonly string[] {
  const doc = validDoc();
  const keys = edit.at.split('/').slice(1);
  const last = keys.pop() ?? '';
  const parent = keys.reduce<Record<string, unknown>>(
    (node, key) => node[key] as Record<string, unknown>,
    doc,
  );
  if (edit.value === REMOVE) Reflect.deleteProperty(parent, last);
  else parent[last] = edit.value;
  const issues = validateManifest(doc);
  return issues.map(issue => issue.pointer);
}

const D0 = '/acceptedDeltas/0';
const RFC_TOKEN_KEY = 'a/~b';

const INVALID_CASES: readonly IInvalidCase[] = [
  { id: 'BSM-1', what: 'a missing $comment', at: '/$comment', value: REMOVE, pointer: '/$comment' },
  { id: 'BSM-2', what: 'a blank $comment', at: '/$comment', value: '   ', pointer: '/$comment' },
  { id: 'BSM-3', what: 'an extra root key', at: '/extra', value: 1, pointer: '/extra' },
  {
    id: 'BSM-5',
    what: 'a tag without prerelease',
    at: '/camoufox/tag',
    value: 'v100.0.0',
    pointer: '/camoufox/tag',
  },
  {
    id: 'BSM-6',
    what: 'a tag without the v',
    at: '/camoufox/tag',
    value: '100.0.0-beta.1',
    pointer: '/camoufox/tag',
  },
  {
    id: 'BSM-7',
    what: 'an rc tag',
    at: '/camoufox/tag',
    value: 'v100.0.0-rc.1',
    pointer: '/camoufox/tag',
  },
  { id: 'BSM-8', what: 'a numeric tag', at: '/camoufox/tag', value: 100, pointer: '/camoufox/tag' },
  {
    id: 'BSM-9',
    what: 'a tag with a trailing space',
    at: '/camoufox/tag',
    value: `${SAMPLE_TAG} `,
    pointer: '/camoufox/tag',
  },
  {
    id: 'BSM-10',
    what: 'an extra camoufox key',
    at: '/camoufox/sha',
    value: 'x',
    pointer: '/camoufox/sha',
  },
  {
    id: 'BSM-11',
    what: 'an array camoufox',
    at: '/camoufox',
    value: [SAMPLE_TAG],
    pointer: '/camoufox',
  },
  {
    id: 'BSM-12',
    what: 'a full semver minor',
    at: '/playwrightCore/testedMinor',
    value: '1.63.0',
    pointer: '/playwrightCore/testedMinor',
  },
  {
    id: 'BSM-13',
    what: 'a range minor',
    at: '/playwrightCore/testedMinor',
    value: '^1.63',
    pointer: '/playwrightCore/testedMinor',
  },
  {
    id: 'BSM-14',
    what: 'a missing playwrightCore',
    at: '/playwrightCore',
    value: REMOVE,
    pointer: '/playwrightCore',
  },
  {
    id: 'BSM-15',
    what: 'object acceptedDeltas',
    at: '/acceptedDeltas',
    value: {},
    pointer: '/acceptedDeltas',
  },
  {
    id: 'BSM-16',
    what: 'an unknown channel',
    at: `${D0}/channel`,
    value: 'response',
    pointer: `${D0}/channel`,
  },
  {
    id: 'BSM-17',
    what: 'an unknown kind',
    at: `${D0}/kind`,
    value: 'MISSING-FIELD',
    pointer: `${D0}/kind`,
  },
  {
    id: 'BSM-18',
    what: 'a lower-case domain',
    at: `${D0}/path`,
    value: 'browser.close',
    pointer: `${D0}/path`,
  },
  {
    id: 'BSM-19',
    what: 'a signature without dst',
    at: `${D0}/signature`,
    value: 'src:Boolean',
    pointer: `${D0}/signature`,
  },
  {
    id: 'BSM-20',
    what: 'a 9-character reason',
    at: `${D0}/reason`,
    value: '123456789',
    pointer: `${D0}/reason`,
  },
  {
    id: 'BSM-21',
    what: 'a blank reason',
    at: `${D0}/reason`,
    value: ' '.repeat(12),
    pointer: `${D0}/reason`,
  },
  {
    id: 'BSM-22',
    what: 'a 241-character reason',
    at: `${D0}/reason`,
    value: 'r'.repeat(241),
    pointer: `${D0}/reason`,
  },
  {
    id: 'BSM-23',
    what: 'a delta without reason',
    at: `${D0}/reason`,
    value: REMOVE,
    pointer: `${D0}/reason`,
  },
  {
    id: 'BSM-24',
    what: 'an extra delta key',
    at: `${D0}/status`,
    value: 'NEW',
    pointer: `${D0}/status`,
  },
  { id: 'BSM-25', what: 'a non-object delta', at: D0, value: 'x', pointer: D0 },
  {
    id: 'BSM-26',
    what: 'a repeated identity with another reason',
    at: '/acceptedDeltas/1',
    value: { ...BASE_DELTA, reason: 'another ten-plus reason' },
    pointer: '/acceptedDeltas/1',
  },
  {
    id: 'BSM-33',
    what: 'a leading-zero tag version',
    at: '/camoufox/tag',
    value: 'v0100.0.0-beta.1',
    pointer: '/camoufox/tag',
  },
  {
    id: 'BSM-34',
    what: 'a leading-zero prerelease number',
    at: '/camoufox/tag',
    value: 'v100.0.0-beta.01',
    pointer: '/camoufox/tag',
  },
  {
    id: 'BSM-35',
    what: 'a leading-zero minor',
    at: '/playwrightCore/testedMinor',
    value: '1.063',
    pointer: '/playwrightCore/testedMinor',
  },
  { id: 'BSM-38', what: 'a missing asset digest', at: SHA_AT, value: REMOVE, pointer: SHA_AT },
  {
    id: 'BSM-39',
    what: "GitHub's sha256:-prefixed digest",
    at: SHA_AT,
    value: `sha256:${SAMPLE_SHA256}`,
    pointer: SHA_AT,
  },
  {
    id: 'BSM-40',
    what: 'an uppercase digest',
    at: SHA_AT,
    value: SAMPLE_SHA256.toUpperCase(),
    pointer: SHA_AT,
  },
  { id: 'BSM-41', what: 'a 63-digit digest', at: SHA_AT, value: 'a'.repeat(63), pointer: SHA_AT },
  { id: 'BSM-42', what: 'a 65-digit digest', at: SHA_AT, value: 'a'.repeat(65), pointer: SHA_AT },
];

const VALID_EDITS: readonly IEdit[] = [
  { what: 'an alpha tag', at: '/camoufox/tag', value: 'v156.0.1-alpha.3' },
  { what: 'zero version components', at: '/camoufox/tag', value: 'v0.0.0-beta.0' },
  { what: 'a zero minor', at: '/playwrightCore/testedMinor', value: '2.0' },
  { what: 'an all-digit digest', at: SHA_AT, value: '0123456789'.repeat(6).concat('0123') },
  { what: 'no accepted deltas', at: '/acceptedDeltas', value: [] },
  {
    what: 'an ENUM-VALUE suffix',
    at: `${D0}/path`,
    value: 'Page.navigate.referrerPolicy=no-referrer',
  },
  { what: 'an array segment', at: `${D0}/path`, value: 'Browser.setHTTPCredentials.credentials[]' },
  { what: 'a 10-character reason', at: `${D0}/reason`, value: '0123456789' },
  { what: 'a 240-character reason', at: `${D0}/reason`, value: 'r'.repeat(240) },
  {
    what: 'the same path with another signature',
    at: '/acceptedDeltas/1',
    value: { ...BASE_DELTA, signature: 'src:String|dst:Number' },
  },
];

/** Exit status and output of one CLI run. */
interface ICliRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the CLI as CI does.
 *
 * @param args - Arguments after the script path.
 * @returns Exit status (-1 when killed) and both output streams.
 */
function runCli(args: readonly string[]): ICliRun {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Write the valid baseline, with another tag, into a directory.
 *
 * @param dir - Existing directory to write `browser-stack.json` into.
 * @param tag - Value written to `camoufox.tag`.
 * @returns Path of the written file.
 */
function writeManifestWithTag(dir: string, tag: string): string {
  const file = join(dir, 'browser-stack.json');
  const doc = validDoc();
  const camoufox = doc.camoufox as Record<string, unknown>;
  camoufox.tag = tag;
  const text = JSON.stringify(doc);
  writeFileSync(file, text);
  return file;
}

/**
 * Run the CLI against a temporary copy of the valid baseline with another tag.
 *
 * @param tag - Value written to `camoufox.tag`.
 * @returns The CLI run.
 */
function runCliWithTag(tag: string): ICliRun {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, 'browser-stack-manifest-');
  const dir = mkdtempSync(prefix);
  const file = writeManifestWithTag(dir, tag);
  const run = runCli(['tag', file]);
  rmSync(dir, { recursive: true, force: true });
  return run;
}

describe('browser-stack manifest contract', () => {
  it('[BSM-0] accepts the valid baseline document', () => {
    const doc = validDoc();
    const issues = validateManifest(doc);
    expect(issues).toEqual([]);
  });

  it('[BSM-4] escapes an unknown key per RFC 6901 in its pointer', () => {
    const doc = { ...validDoc(), [RFC_TOKEN_KEY]: 1 };
    const issues = validateManifest(doc);
    const pointers = issues.map(issue => issue.pointer);
    expect(pointers).toEqual(['/a~1~0b']);
  });

  it.each(INVALID_CASES)('[$id] rejects $what at $pointer', edit => {
    const pointers = pointersAfter(edit);
    expect(pointers).toEqual([edit.pointer]);
  });

  it.each([null, [], SAMPLE_TAG])('[BSM-27] rejects a non-object root (%j)', root => {
    const issues = validateManifest(root);
    expect(issues).toEqual([{ pointer: '', reason: 'must be an object' }]);
  });

  it.each(VALID_EDITS)('[BSM-28] accepts $what', edit => {
    const pointers = pointersAfter(edit);
    expect(pointers).toEqual([]);
  });

  it('[BSM-29] the real browser-stack.json is valid and pins a release tag and digest', () => {
    const { manifest, issues } = loadManifest(REAL_MANIFEST);
    const tag = manifest?.camoufox.tag ?? '';
    const digest = manifest?.camoufox.linuxX64Sha256 ?? '';
    expect(issues).toEqual([]);
    expect(tag).toMatch(CAMOUFOX_TAG);
    expect(digest).toMatch(SHA256_HEX);
  });
});

describe('browser-stack manifest CLI', () => {
  it('[BSM-30] prints only the pinned tag for the real manifest', () => {
    const { manifest } = loadManifest(REAL_MANIFEST);
    const tag = manifest?.camoufox.tag ?? '';
    const run = runCli(['tag']);
    expect(run).toEqual({ status: 0, stdout: `${tag}\n`, stderr: '' });
  });

  it('[BSM-43] prints only the pinned asset digest for the real manifest', () => {
    const { manifest } = loadManifest(REAL_MANIFEST);
    const digest = manifest?.camoufox.linuxX64Sha256 ?? '';
    const run = runCli(['sha256']);
    expect(run).toEqual({ status: 0, stdout: `${digest}\n`, stderr: '' });
  });

  it('[BSM-31] fails closed on an invalid manifest: exit 2, no tag, MANIFEST-INVALID', () => {
    const run = runCliWithTag('latest');
    expect(run).toMatchObject({ status: 2, stdout: '' });
    expect(run.stderr).toBe(`MANIFEST-INVALID /camoufox/tag must match ${CAMOUFOX_TAG.source}\n`);
  });

  it.each([[[]], [['toString']], [['tag', MISSING_MANIFEST]]])(
    '[BSM-32] exits 2 without a tag for argv %j',
    args => {
      const run = runCli(args);
      expect(run).toMatchObject({ status: 2, stdout: '' });
    },
  );
});
