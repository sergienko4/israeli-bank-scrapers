/**
 * The forensic runs root is provisioned component by component: every
 * component must be a real directory owned by the current user, and a
 * group/world-writable or symlinked path fails closed before any log or
 * network capture can be written into it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import ensurePrivateRunRoot from '../../../../Scrapers/Pipeline/Types/SecureRunRoot.js';

/** Base directories created by a case, removed afterwards. */
const CREATED_DIRS: string[] = [];

/**
 * Create a private temp directory tracked for cleanup.
 * @param prefix - Directory-name prefix.
 * @returns Absolute path of the new directory.
 */
function makeTempDir(prefix: string): string {
  const tempRoot = os.tmpdir();
  const prefixPath = path.join(tempRoot, prefix);
  const dir = fs.mkdtempSync(prefixPath);
  CREATED_DIRS.push(dir);
  return dir;
}

/**
 * Read only the permission bits of a path.
 * @param target - File or directory.
 * @returns Permission bits (for example `0o700`).
 */
function modeOf(target: string): number {
  return fs.statSync(target).mode & 0o777;
}

const DESCRIBE_POSIX = process.platform === 'win32' ? describe.skip : describe;

DESCRIBE_POSIX('ensurePrivateRunRoot', () => {
  afterEach(() => {
    const dirs = CREATED_DIRS.splice(0);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates every missing component with owner-only mode', () => {
    const base = makeTempDir('secure-root-create-');
    const root = path.join(base, 'nested', 'runs');
    ensurePrivateRunRoot(root);
    const rootMode = modeOf(root);
    const nested = path.join(base, 'nested');
    const nestedMode = modeOf(nested);
    expect(rootMode).toBe(0o700);
    expect(nestedMode).toBe(0o700);
  });

  it('tightens an existing owner directory to 0700', () => {
    const base = makeTempDir('secure-root-tighten-');
    const root = path.join(base, 'runs');
    fs.mkdirSync(root, { mode: 0o755 });
    fs.chmodSync(root, 0o755);
    ensurePrivateRunRoot(root);
    const rootMode = modeOf(root);
    expect(rootMode).toBe(0o700);
  });

  it('rejects a group/world-writable root', () => {
    const base = makeTempDir('secure-root-world-writable-');
    const root = path.join(base, 'runs');
    fs.mkdirSync(root, { mode: 0o700 });
    fs.chmodSync(root, 0o777);
    expect(() => ensurePrivateRunRoot(root)).toThrow(/runs root ancestor is not safe/);
  });

  it('resolves a symlinked root to its canonical private target', () => {
    const base = makeTempDir('secure-root-symlink-');
    const target = makeTempDir('secure-root-symlink-target-');
    const root = path.join(base, 'runs');
    fs.symlinkSync(target, root);
    const canonical = ensurePrivateRunRoot(root);
    const expected = fs.realpathSync(target);
    expect(canonical).toBe(expected);
    const mode = modeOf(expected);
    expect(mode).toBe(0o700);
  });

  it('rejects a group/world-writable ancestor', () => {
    const base = makeTempDir('secure-root-unsafe-parent-');
    const parent = path.join(base, 'shared');
    fs.mkdirSync(parent, { mode: 0o700 });
    fs.chmodSync(parent, 0o777);
    const root = path.join(parent, 'runs');
    expect(() => ensurePrivateRunRoot(root)).toThrow(/runs root ancestor is not safe/);
  });

  it('rejects an existing root under an unsafe ancestor', () => {
    const base = makeTempDir('secure-root-existing-unsafe-');
    const parent = path.join(base, 'shared');
    fs.mkdirSync(parent, { mode: 0o700 });
    fs.chmodSync(parent, 0o777);
    const root = path.join(parent, 'runs');
    fs.mkdirSync(root, { mode: 0o700 });
    fs.chmodSync(root, 0o700);
    expect(() => ensurePrivateRunRoot(root)).toThrow(/runs root ancestor is not safe/);
  });
});
