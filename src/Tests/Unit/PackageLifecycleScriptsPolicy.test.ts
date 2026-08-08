/**
 * Drift pin for consumer-executed npm lifecycle scripts.
 *
 * npm runs `preinstall`, `install` and `postinstall` **in the consumer's
 * project** when this package is installed as a dependency. Anything such a
 * script touches must therefore be present on the consumer's machine:
 * `devDependencies` are never installed for them, and files outside `files`
 * are never published.
 *
 * Regression this pins (shipped in 8.6.4, reproduced on clean Ubuntu
 * 24.04 + Node 20.20.2):
 *
 *   "postinstall": "patch-package"   with patch-package in devDependencies
 *
 * Consumer `npm i @sergienko4/israeli-bank-scrapers` ran `patch-package`,
 * which was absent from their tree, so the shell exited 127 and the whole
 * install failed — the package was uninstallable. Compounding it, `files`
 * listed only the build output, so `patches/` was never published either:
 * the script could not have done useful work even had the binary resolved.
 *
 * The defect was never "a postinstall script exists" — it was three
 * independent contract breaches. This pin asserts those three contracts
 * directly, so a consumer-executed script is allowed only when it is
 * genuinely safe:
 *
 *   1. it runs through `node`, never a `node_modules/.bin` shim that only
 *      a devDependency would provide;
 *   2. every file it references is published via `files` and exists;
 *   3. it cannot fail the install (`|| exit 0`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.join(SELF_DIR, '..', '..', '..');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

/** npm lifecycle scripts that execute in a consumer's project on install. */
const CONSUMER_EXECUTED_LIFECYCLE = ['preinstall', 'install', 'postinstall'] as const;

/** Suffix that makes a lifecycle script incapable of failing the install. */
const NON_FATAL_SUFFIX = '|| exit 0';

/** Matches whitespace-delimited tokens that name a repo-relative file. */
const LOCAL_PATH_TOKEN = /(?:^|\s)((?:\.\/)?[\w.-]+(?:\/[\w.-]+)+)/g;

interface IPackageManifest {
  scripts?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Read and parse the root package.json.
 * @returns Parsed manifest.
 */
function loadPackageJson(): IPackageManifest {
  const raw = readFileSync(PACKAGE_JSON_PATH, 'utf8');
  return JSON.parse(raw) as IPackageManifest;
}

/**
 * Collect the consumer-executed lifecycle scripts the manifest declares.
 * @returns Entries of `[lifecycle, command]` for declared scripts only.
 */
function declaredConsumerScripts(): [string, string][] {
  const scripts = loadPackageJson().scripts ?? {};
  const declared = CONSUMER_EXECUTED_LIFECYCLE.filter(name => Object.hasOwn(scripts, name));
  return declared.map((name): [string, string] => [name, scripts[name]]);
}

/**
 * Extract repo-relative file paths referenced by a shell command.
 * @param command Lifecycle script command line.
 * @returns Normalised paths, without any leading `./`.
 */
function referencedPaths(command: string): string[] {
  const matches = [...command.matchAll(LOCAL_PATH_TOKEN)];
  return matches.map(match => match[1].replace(/^\.\//, ''));
}

/**
 * Decide whether a `files` entry publishes the given repo-relative path.
 * @param entry Single `files` glob or literal path.
 * @param filePath Repo-relative path to test.
 * @returns True when the entry publishes the path.
 */
function entryPublishes(entry: string, filePath: string): boolean {
  const normalised = entry.replace(/^\.\//, '');
  const globIndex = normalised.indexOf('*');
  if (globIndex === -1) return normalised === filePath;
  const literalPrefix = normalised.slice(0, globIndex);
  return filePath.startsWith(literalPrefix);
}

describe('package.json consumer-executed lifecycle scripts', () => {
  it('invokes only node, never a devDependency binary shim', () => {
    for (const [lifecycle, command] of declaredConsumerScripts()) {
      expect([lifecycle, command.trim().split(/\s+/)[0]]).toEqual([lifecycle, 'node']);
    }
  });

  it('references only files published via the files field', () => {
    const files = loadPackageJson().files ?? [];
    for (const [, command] of declaredConsumerScripts()) {
      for (const target of referencedPaths(command)) {
        const isPublished = files.some(entry => entryPublishes(entry, target));
        const absolutePath = path.join(REPO_ROOT, target);
        expect([target, isPublished]).toEqual([target, true]);
        expect([target, existsSync(absolutePath)]).toEqual([target, true]);
      }
    }
  });

  it('cannot fail the consumer install', () => {
    for (const [lifecycle, command] of declaredConsumerScripts()) {
      expect([lifecycle, command.trim().endsWith(NON_FATAL_SUFFIX)]).toEqual([lifecycle, true]);
    }
  });

  it('keeps patch-package out of the dependency tree entirely', () => {
    const pkg = loadPackageJson();
    expect(pkg.dependencies?.['patch-package']).toBeUndefined();
    expect(pkg.devDependencies?.['patch-package']).toBeUndefined();
  });
});
