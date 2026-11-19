/**
 * Guards the compatibility automation: the `unreleased` sentinel, the
 * upgrade-note selector, release-time stamping and the version guard.
 *
 * These scripts sit outside the TypeScript program, so nothing else in the
 * suite exercises them. Each case pins the behaviour the release process
 * relies on: no author ever types a release number, and a guessed number is
 * either corrected at release time or rejected before review.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const SENTINEL = 'unreleased';
const PROPOSED = '10.1.0';
const RELEASED = '10.0.1';
const PRIOR = '10.0.0';
const GUESSED = '10.4.0';
const HISTORICAL = '8.3.0';
const OLD = '9.0.0';
const PENDING_TITLE = 'Pending change';
const OLD_TITLE = 'Old change';
const GUESSED_TITLE = 'Guessed';

interface ICompatEntry {
  version: string;
  title: string;
  impact: string;
  detail: string;
  action: string;
  before?: string;
  after?: string;
}

interface ICompatData {
  runtime: { node: string };
  entries: ICompatEntry[];
}

interface IBuildModule {
  UNRELEASED: string;
  assertKnownImpacts: (entries: ICompatEntry[]) => unknown;
  compareSemver: (left: string, right: string) => number;
  isSemanticVersion: (value: string) => boolean;
  renderPage: (data: ICompatData) => string;
}

interface ISectionOptions {
  releasedVersions?: readonly string[];
  includePending?: boolean;
}

interface IUpgradeModule {
  parseVersion: (args: string[]) => unknown;
  renderSection: (version: string, data: ICompatData, options?: ISectionOptions) => string;
}

interface IStampResult {
  data: ICompatData;
  stamped: number;
}

interface IStampModule {
  stampData: (data: ICompatData, version: string, released: readonly string[]) => IStampResult;
}

interface IGuardOptions {
  releasedVersions: readonly string[];
  pendingVersions?: readonly string[];
  strict?: boolean;
}

interface IGuardModule {
  versionProblems: (entries: ICompatEntry[], options: IGuardOptions) => string[];
}

/**
 * Loads an ESM script from `scripts/` by absolute path.
 * @param name File name inside `scripts/`.
 * @returns The module namespace, typed by the caller.
 */
async function loadScript<T>(name: string): Promise<T> {
  const scriptPath = join(SCRIPTS_DIR, name);
  const scriptUrl = pathToFileURL(scriptPath);
  const loaded: unknown = await import(scriptUrl.href);
  return loaded as T;
}

/**
 * Builds a compatibility entry with overridable fields.
 * @param overrides Fields to replace.
 * @returns A complete entry.
 */
function buildEntry(overrides: Partial<ICompatEntry> = {}): ICompatEntry {
  return {
    version: PRIOR,
    title: 'A change',
    impact: 'behavior',
    detail: 'The behaviour changed.',
    action: 'Adjust the call.',
    ...overrides,
  };
}

/**
 * Builds a compatibility document around the given entries.
 * @param entries Entry list.
 * @returns A parsed-document shape.
 */
function buildData(entries: ICompatEntry[]): ICompatData {
  return { runtime: { node: '>=20' }, entries };
}

/**
 * Writes the two files the stamp script reads and writes.
 * @param root Fixture root.
 * @param data Compatibility document.
 * @returns True once the fixture exists.
 */
function writeFixture(root: string, data: ICompatData): true {
  const docsDir = join(root, 'docs');
  const dataPath = join(root, 'compatibility.json');
  const pagePath = join(docsDir, 'compatibility.md');
  const json = JSON.stringify(data, null, 2);
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(dataPath, json);
  writeFileSync(pagePath, '');
  return true;
}

/**
 * Writes the proposed version the guard treats as pending.
 * @param root Fixture root.
 * @param version Version release-please proposed.
 * @returns True once the manifest exists.
 */
function writePackage(root: string, version: string): true {
  const packagePath = join(root, 'package.json');
  const json = JSON.stringify({ version }, null, 2);
  writeFileSync(packagePath, json);
  return true;
}

/**
 * Commits the fixture and tags the released version.
 * @param root Fixture root.
 * @param tag Release tag, such as `v10.0.1`.
 * @returns True once the repository is initialized.
 */
function initRepo(root: string, tag: string): true {
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '.']);
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.test'];
  execFileSync('git', ['-C', root, ...identity, 'commit', '-qm', 'init']);
  execFileSync('git', ['-C', root, 'tag', tag]);
  return true;
}

/**
 * Runs a script and returns its stdout.
 * @param name Script file name.
 * @param args Command-line arguments.
 * @returns Captured stdout.
 */
function runScript(name: string, args: readonly string[]): string {
  const script = join(SCRIPTS_DIR, name);
  return execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

/**
 * Runs a script expected to fail and returns its stderr.
 * @param name Script file name.
 * @param args Command-line arguments.
 * @returns Captured stderr.
 */
function failureOf(name: string, args: readonly string[]): string {
  try {
    runScript(name, args);
  } catch (error) {
    const failure = error as { stderr?: Buffer | string };
    return String(failure.stderr ?? '');
  }
  throw new RangeError(`${name} should have failed`);
}

/**
 * Reads a fixture's compatibility document.
 * @param root Fixture root.
 * @returns The parsed document.
 */
function readFixture(root: string): ICompatData {
  const dataPath = join(root, 'compatibility.json');
  const raw = readFileSync(dataPath, 'utf8');
  return JSON.parse(raw) as ICompatData;
}

describe('build-compatibility sentinel', () => {
  let mod: IBuildModule;

  beforeAll(async () => {
    mod = await loadScript<IBuildModule>('build-compatibility.mjs');
  });

  it('renders the sentinel heading as Unreleased', () => {
    const entry = buildEntry({ version: mod.UNRELEASED, title: 'Next change' });
    const data = buildData([entry]);
    const page = mod.renderPage(data);
    expect(page).toContain('### Unreleased - Next change');
  });

  it('compares numeric versions, not strings', () => {
    const newer = mod.compareSemver(PROPOSED, '9.9.9');
    const equal = mod.compareSemver(PRIOR, PRIOR);
    expect(newer).toBeGreaterThan(0);
    expect(equal).toBe(0);
  });

  it.each([
    [PROPOSED, true],
    ['10.1', false],
    ['v10.1.0', false],
    [SENTINEL, false],
  ])('classifies %s as semantic: %s', (value, expected) => {
    const isSemantic = mod.isSemanticVersion(value);
    expect(isSemantic).toBe(expected);
  });
});

describe('upgrade-notes sentinel selection', () => {
  let mod: IUpgradeModule;
  const pending = buildEntry({ version: SENTINEL, title: PENDING_TITLE });
  const current = buildEntry({ version: PROPOSED, title: 'Current change' });
  const older = buildEntry({ version: PRIOR, title: OLD_TITLE });

  beforeAll(async () => {
    mod = await loadScript<IUpgradeModule>('upgrade-notes.mjs');
  });

  it('includes the sentinel for the newest release', () => {
    const data = buildData([pending, current, older]);
    const section = mod.renderSection(PROPOSED, data, {
      releasedVersions: [PROPOSED, PRIOR],
      includePending: true,
    });
    expect(section).toContain(PENDING_TITLE);
    expect(section).toContain('Current change');
    expect(section).not.toContain(OLD_TITLE);
  });

  it('excludes the sentinel when a newer release exists', () => {
    const data = buildData([pending, older]);
    const section = mod.renderSection(PRIOR, data, {
      releasedVersions: [PROPOSED, PRIOR],
      includePending: true,
    });
    expect(section).toContain(OLD_TITLE);
    expect(section).not.toContain(PENDING_TITLE);
  });

  it('includes the sentinel when tags are unavailable', () => {
    const data = buildData([pending]);
    const section = mod.renderSection(PROPOSED, data, { includePending: true });
    expect(section).toContain(PENDING_TITLE);
  });

  it('includes a numeric note left pending by a missed stamp', () => {
    const pendingNumeric = buildEntry({ version: PROPOSED, title: 'Pending numeric' });
    const data = buildData([pendingNumeric, older]);
    const section = mod.renderSection('10.2.0', data, {
      releasedVersions: ['10.2.0', RELEASED],
      includePending: true,
    });
    expect(section).toContain('Pending numeric');
    expect(section).not.toContain(OLD_TITLE);
  });

  it('includes a guessed version above the target when pending is requested', () => {
    const guessed = buildEntry({ version: GUESSED, title: 'Guessed pending' });
    const data = buildData([guessed, current]);
    const section = mod.renderSection(PROPOSED, data, {
      releasedVersions: [PROPOSED, RELEASED],
      includePending: true,
    });
    expect(section).toContain('Guessed pending');
    expect(section).toContain('Current change');
  });

  it('excludes pending work added after the latest tag by default', () => {
    const nextNumeric = buildEntry({ version: '10.2.0', title: 'Next work' });
    const data = buildData([pending, nextNumeric, current]);
    const section = mod.renderSection(PROPOSED, data, { releasedVersions: [PROPOSED, RELEASED] });
    expect(section).toContain('Current change');
    expect(section).not.toContain(PENDING_TITLE);
    expect(section).not.toContain('Next work');
  });
});

describe('stamp-compatibility', () => {
  let mod: IStampModule;

  beforeAll(async () => {
    mod = await loadScript<IStampModule>('stamp-compatibility.mjs');
  });

  it('stamps the sentinel and an untagged numeric entry', () => {
    const data = buildData([
      buildEntry({ version: SENTINEL, title: 'Pending' }),
      buildEntry({ version: GUESSED, title: GUESSED_TITLE }),
      buildEntry({ version: PRIOR, title: 'Released' }),
    ]);
    const result = mod.stampData(data, PROPOSED, [PRIOR]);
    const versions = result.data.entries.map(entry => entry.version);
    expect(versions).toEqual([PROPOSED, PROPOSED, PRIOR]);
    expect(result.stamped).toBe(2);
  });

  it('rejects a target that is not newer than the last release', () => {
    const data = buildData([buildEntry({ version: SENTINEL })]);
    /**
     * Attempt to stamp the already-released version.
     * @returns The stamp result, which must throw.
     */
    const act = (): IStampResult => mod.stampData(data, RELEASED, [RELEASED]);
    expect(act).toThrow(/newer/);
  });

  it('does not count an entry already equal to the target', () => {
    const data = buildData([buildEntry({ version: PROPOSED })]);
    const result = mod.stampData(data, PROPOSED, [PRIOR]);
    expect(result.stamped).toBe(0);
  });

  it('leaves an old untagged note alone', () => {
    const data = buildData([buildEntry({ version: HISTORICAL, title: 'Historical' })]);
    const result = mod.stampData(data, PROPOSED, [RELEASED]);
    expect(result.data.entries[0].version).toBe(HISTORICAL);
    expect(result.stamped).toBe(0);
  });

  it('rejects a malformed version', () => {
    const data = buildData([]);
    /**
     * Attempt the stamp with an invalid version.
     * @returns The stamp result, which must throw.
     */
    const act = (): IStampResult => mod.stampData(data, '10.1', []);
    expect(act).toThrow(/semantic/);
  });

  it('stamps a fixture through the CLI and is idempotent', () => {
    const tempDir = tmpdir();
    const prefix = join(tempDir, 'compat-stamp-');
    const root = mkdtempSync(prefix);
    const data = buildData([
      buildEntry({ version: SENTINEL, title: 'Pending' }),
      buildEntry({ version: PRIOR, title: 'Released' }),
    ]);
    writeFixture(root, data);
    initRepo(root, 'v10.0.0');
    const args = ['--version', PROPOSED, '--root', root];
    runScript('stamp-compatibility.mjs', args);
    const stamped = readFixture(root);
    expect(stamped.entries[0].version).toBe(PROPOSED);
    const pagePath = join(root, 'docs', 'compatibility.md');
    const page = readFileSync(pagePath, 'utf8');
    expect(page).toContain(`### ${PROPOSED} - Pending`);
    const second = runScript('stamp-compatibility.mjs', args);
    expect(second).toContain('already stamped');
  });
});

describe('check-compatibility-versions', () => {
  let mod: IGuardModule;
  const options = { releasedVersions: [RELEASED], pendingVersions: [PROPOSED] };

  beforeAll(async () => {
    mod = await loadScript<IGuardModule>('check-compatibility-versions.mjs');
  });

  it('flags a guessed version that is neither tagged nor pending', () => {
    const entries = [buildEntry({ version: GUESSED, title: GUESSED_TITLE })];
    const problems = mod.versionProblems(entries, options);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(GUESSED);
    expect(problems[0]).toContain(SENTINEL);
  });

  it('accepts a released, a pending and a sentinel entry', () => {
    const entries = [
      buildEntry({ version: SENTINEL }),
      buildEntry({ version: PROPOSED }),
      buildEntry({ version: RELEASED }),
    ];
    const problems = mod.versionProblems(entries, options);
    expect(problems).toEqual([]);
  });

  it('flags the sentinel when it follows a released entry', () => {
    const entries = [buildEntry({ version: RELEASED }), buildEntry({ version: SENTINEL })];
    const problems = mod.versionProblems(entries, options);
    const hasMisplaced = problems.some((problem): boolean => problem.includes('must come first'));
    expect(hasMisplaced).toBe(true);
  });

  it('flags a newer version after an older one', () => {
    const entries = [buildEntry({ version: OLD }), buildEntry({ version: RELEASED })];
    const problems = mod.versionProblems(entries, options);
    const isOutOfOrder = problems.some((problem): boolean => problem.includes('newer'));
    expect(isOutOfOrder).toBe(true);
  });

  it('rejects a pending version in strict mode', () => {
    const entries = [buildEntry({ version: PROPOSED })];
    const strict = { ...options, strict: true };
    const problems = mod.versionProblems(entries, strict);
    const hasVersion = problems.some((problem): boolean => problem.includes(PROPOSED));
    expect(hasVersion).toBe(true);
  });

  it('accepts an old untagged note in strict mode', () => {
    const entries = [buildEntry({ version: HISTORICAL })];
    const strict = {
      releasedVersions: [RELEASED, PROPOSED],
      strict: true,
    };
    const problems = mod.versionProblems(entries, strict);
    expect(problems).toEqual([]);
  });

  it('fails the CLI for a guessed version against the base', () => {
    const tempDir = tmpdir();
    const prefix = join(tempDir, 'compat-guard-');
    const root = mkdtempSync(prefix);
    const baseData = buildData([buildEntry({ version: RELEASED })]);
    writeFixture(root, baseData);
    writePackage(root, RELEASED);
    initRepo(root, 'v10.0.1');
    const guessedData = buildData([buildEntry({ version: GUESSED, title: GUESSED_TITLE })]);
    writeFixture(root, guessedData);
    const args = ['--root', root, '--base', 'HEAD'];
    const failure = failureOf('check-compatibility-versions.mjs', args);
    expect(failure).toContain(GUESSED);
    expect(failure).toContain(SENTINEL);
  });
});
