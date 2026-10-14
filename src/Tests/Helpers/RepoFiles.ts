/**
 * RepoFiles — the files git tracks, read from the repo root.
 *
 * <p>Tracked files are what CI checks out and what ships, so a repo-wide
 * oracle that lists them is not fooled by a developer's untracked scratch
 * files and does not walk `node_modules`.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../');

/**
 * Every file git tracks, relative to the repo root.
 *
 * @returns Repo-relative paths; throws when git fails.
 */
function trackedFiles(): readonly string[] {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new RangeError(`git ls-files exited ${String(result.status)}`);
  return result.stdout.split('\0').filter(path => path !== '');
}

/**
 * Read a tracked file.
 *
 * @param path - Repo-relative path.
 * @returns Its text.
 */
function readRepoFile(path: string): string {
  const absolute = join(REPO_ROOT, path);
  return readFileSync(absolute, 'utf8');
}

export { readRepoFile, trackedFiles };
