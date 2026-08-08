/**
 * Drift pin for consumer-executed npm lifecycle scripts.
 *
 * npm runs `preinstall`, `install` and `postinstall` **in the consumer's
 * project** when this package is installed as a dependency. Every binary
 * such a script invokes must therefore resolve from `dependencies` on the
 * consumer's machine — `devDependencies` are never installed for them.
 *
 * Regression this pins (shipped in 8.6.4, reproduced on clean Ubuntu
 * 24.04 + Node 20.20.2):
 *
 *   "postinstall": "patch-package"   with patch-package in devDependencies
 *
 * Consumer `npm i @sergienko4/israeli-bank-scrapers` ran `patch-package`,
 * which was absent from their tree, so the shell exited 127 and the whole
 * install failed. The package was uninstallable.
 *
 * Compounding it, `files` is `lib/**\/*`, so `patches/` is not published
 * either — the script could never have done useful work for a consumer
 * even if the binary had resolved.
 *
 * The fix moved patch application into `prepare`, which npm runs for local
 * development, `npm ci`, and before pack/publish, but **not** when the
 * package is installed as a dependency from the registry.
 *
 * This pin asserts the published manifest declares no consumer-executed
 * lifecycle script at all. If one is ever genuinely needed, it must ship
 * its binary in `dependencies` and this pin must be updated deliberately.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.join(SELF_DIR, '..', '..', '..');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

/** npm lifecycle scripts that execute in a consumer's project on install. */
const CONSUMER_EXECUTED_LIFECYCLE = ['preinstall', 'install', 'postinstall'] as const;

/** Lifecycle scripts npm runs only for local dev / pack / publish. */
const LOCAL_ONLY_LIFECYCLE = 'prepare';

interface IPackageManifest {
  scripts?: Record<string, string>;
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

describe('package.json consumer-executed lifecycle scripts', () => {
  it.each(CONSUMER_EXECUTED_LIFECYCLE)('declares no "%s" script', lifecycle => {
    const scripts = loadPackageJson().scripts ?? {};
    expect(scripts[lifecycle]).toBeUndefined();
  });

  it('applies patches via the local-only prepare lifecycle', () => {
    const scripts = loadPackageJson().scripts ?? {};
    expect(scripts[LOCAL_ONLY_LIFECYCLE]).toContain('patch-package');
  });

  it('keeps patch-package out of runtime dependencies', () => {
    const pkg = loadPackageJson();
    expect(pkg.dependencies?.['patch-package']).toBeUndefined();
    expect(pkg.devDependencies?.['patch-package']).toBeDefined();
  });
});
