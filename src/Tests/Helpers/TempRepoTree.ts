import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Creates an isolated repository fixture; the caller owns its cleanup.
 * @returns Fixture root.
 */
export function createTempRepo(): string {
  const temp = tmpdir();
  const prefix = join(temp, 'repo-contract-');
  return mkdtempSync(prefix);
}

/**
 * Writes a fixture file with its parent directories.
 * @param root Fixture repository root.
 * @param relative Repository-relative file path.
 * @param content Fixture contents.
 * @returns Absolute file path.
 */
export function writeTempFile(root: string, relative: string, content: string): string {
  const target = join(root, relative);
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  writeFileSync(target, content);
  return target;
}
