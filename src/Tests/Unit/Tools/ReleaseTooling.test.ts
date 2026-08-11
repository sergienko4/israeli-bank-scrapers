/**
 * Guards the release-note tooling under `scripts/`.
 *
 * These scripts gate CI and shape what consumers read on a GitHub Release,
 * yet they sit outside the TypeScript program, so nothing else in the
 * suite exercises them. Each case below pins a behaviour that was either
 * reported as a defect in review or is relied on by a workflow step.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');

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

interface IBreakingNoteModule {
  findBreaking: (messages: string[]) => string[];
  footerOf: (message: string) => string;
}

interface IUpgradeNotesModule {
  /** Yields the parsed version, or `null` when no usable flag was given. */
  parseVersion: (args: string[]) => unknown;
  renderSection: (version: string, data: ICompatData) => string;
}

interface IBuildCompatModule {
  /** Throws on an unknown impact; the return value is unused. */
  assertKnownImpacts: (entries: ICompatEntry[]) => unknown;
}

/**
 * Loads an ESM script from `scripts/` by absolute path.
 *
 * `tsconfig.json` sets `allowJs: false` and includes only `src`, so a
 * static import of these `.mjs` files cannot type-resolve. A dynamic
 * import keeps them loadable without widening the program.
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
    version: '9.0.0',
    title: 'OneZeroScraper export removed',
    impact: 'breaking',
    detail: 'The class is no longer exported.',
    action: 'Call `createScraper` instead.',
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
 * Wraps the impact check in a thunk that `expect(...).toThrow()` can drive.
 * @param mod Loaded build-compatibility module.
 * @param overrides Entry fields to replace.
 * @returns A thunk that runs the check over one entry.
 */
function checkingImpact(mod: IBuildCompatModule, overrides: Partial<ICompatEntry>): () => unknown {
  const entries = [buildEntry(overrides)];
  return () => mod.assertKnownImpacts(entries);
}

describe('check-breaking-note', () => {
  let mod: IBreakingNoteModule;

  beforeAll(async () => {
    mod = await loadScript<IBreakingNoteModule>('check-breaking-note.mjs');
  });

  it('flags the conventional bang form in the subject', () => {
    const subject = 'feat(api)!: drop the legacy export';
    const found = mod.findBreaking([subject]);
    expect(found).toEqual([subject]);
  });

  it('flags a BREAKING CHANGE footer', () => {
    const message = 'feat: rework auth\n\nSome body.\n\nBREAKING CHANGE: tokens are now required.';
    const found = mod.findBreaking([message]);
    expect(found).toEqual(['feat: rework auth']);
  });

  it('flags a BREAKING CHANGE footer that precedes other trailers', () => {
    const message =
      'feat: rework auth\n\nBREAKING CHANGE: tokens required.\n\nCo-authored-by: S <s@e.com>';
    const found = mod.findBreaking([message]);
    expect(found).toEqual(['feat: rework auth']);
  });

  // Regression: the bang pattern carried the `m` flag, so a body line
  // quoting the syntax tripped the gate. Documenting it is not breaking.
  it('ignores the bang form quoted in the commit body', () => {
    const message =
      'docs: explain the checker\n\nA breaking commit looks like\nfeat!: drop x\nand needs a note.';
    const found = mod.findBreaking([message]);
    expect(found).toEqual([]);
  });

  // Regression: the footer token was matched anywhere in the message.
  it('ignores BREAKING CHANGE mentioned in prose', () => {
    const body = 'The gate looks for BREAKING CHANGE: in the footer.';
    const message = `docs: explain the checker\n\n${body}\n\nCo-authored-by: S <s@e.com>`;
    const found = mod.findBreaking([message]);
    expect(found).toEqual([]);
  });

  it('leaves ordinary commits alone', () => {
    const found = mod.findBreaking(['fix: correct a typo', 'chore: bump deps']);
    expect(found).toEqual([]);
  });

  it('never treats the subject as a footer', () => {
    const footer = mod.footerOf('BREAKING CHANGE: not a real footer');
    expect(footer).toBe('');
  });
});

describe('upgrade-notes', () => {
  let mod: IUpgradeNotesModule;

  beforeAll(async () => {
    mod = await loadScript<IUpgradeNotesModule>('upgrade-notes.mjs');
  });

  it.each([
    ['--version', '8.6.6'],
    ['--tag', 'v8.6.6'],
  ])('reads the version from %s', (flag, value) => {
    const parsed = mod.parseVersion(['node', 'upgrade-notes.mjs', flag, value]);
    expect(parsed).toBe('8.6.6');
  });

  it('yields null when no version flag is present', () => {
    const parsed = mod.parseVersion(['node', 'upgrade-notes.mjs']);
    expect(parsed).toBeNull();
  });

  it('yields null when the version flag carries no value', () => {
    const parsed = mod.parseVersion(['node', 'upgrade-notes.mjs', '--version']);
    expect(parsed).toBeNull();
  });

  // Regression: the candidate was taken verbatim, so this rendered notes
  // headed "Upgrading to --tag" instead of showing the usage error.
  it('yields null when the next argument is another option', () => {
    const parsed = mod.parseVersion(['node', 'upgrade-notes.mjs', '--version', '--tag', 'v9.0.0']);
    expect(parsed).toBeNull();
  });

  it('renders the impact, detail and action for a matching entry', () => {
    const data = buildData([buildEntry()]);
    const section = mod.renderSection('9.0.0', data);
    expect(section).toContain('## Upgrading to 9.0.0');
    expect(section).toContain('OneZeroScraper export removed');
    expect(section).toContain('**What to do:** Call `createScraper` instead.');
  });

  it('renders before and after snippets when present', () => {
    const entry = buildEntry({ before: 'new OneZeroScraper()', after: 'createScraper()' });
    const data = buildData([entry]);
    const section = mod.renderSection('9.0.0', data);
    expect(section).toContain('new OneZeroScraper()');
    expect(section).toContain('createScraper()');
  });

  it('states that a quiet release is a drop-in upgrade', () => {
    const data = buildData([buildEntry()]);
    const section = mod.renderSection('8.6.7', data);
    expect(section).toContain('No action required');
  });

  it('always states the Node requirement and links the full notes', () => {
    const data = buildData([]);
    const section = mod.renderSection('8.6.7', data);
    expect(section).toContain('Requires Node >=20.');
    expect(section).toContain('https://sergienko4.github.io/israeli-bank-scrapers/compatibility/');
  });
});

describe('build-compatibility', () => {
  let mod: IBuildCompatModule;

  beforeAll(async () => {
    mod = await loadScript<IBuildCompatModule>('build-compatibility.mjs');
  });

  it.each(['breaking', 'dependency', 'behavior'])('accepts the %s impact', impact => {
    const act = checkingImpact(mod, { impact });
    expect(act).not.toThrow();
  });

  it('rejects an unknown impact and names the offending entry', () => {
    const act = checkingImpact(mod, { version: '9.1.0', impact: 'urgent' });
    expect(act).toThrow(/9\.1\.0 -> "urgent"/);
  });

  // Regression: the check tested truthiness of the label lookup, so any
  // `Object.prototype` member passed and rendered a function into the page.
  it.each(['toString', 'constructor', 'valueOf'])('rejects the inherited name %s', impact => {
    const act = checkingImpact(mod, { impact });
    expect(act).toThrow(/unknown impact/);
  });
});
