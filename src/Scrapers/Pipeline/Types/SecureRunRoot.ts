/**
 * Secure provisioning for the forensic runs root.
 *
 * <p>On POSIX the default root lives under a shared temp directory, so a
 * predictable path can be pre-created by another local user. Every missing
 * component is created one at a time and must end up as a real directory owned
 * by the current user with no group/other access before forensic data is
 * written into it. Unsafe existing paths fail closed.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import ScraperError from '../../Base/ScraperError.js';
import type { Brand } from './Brand.js';

/** Canonical runs root returned to the caller. */
type RunRootPath = Brand<string, 'RunRootPath'>;

/** Mode bits that let another user write into or replace a component. */
const UNSAFE_BITS = 0o022;

/** Effective uid, or undefined on platforms without POSIX ownership. */
const UID = typeof process.getuid === 'function' ? process.getuid() : undefined;

/**
 * Real path of the platform temp directory — the one ancestor allowed to be
 * group/world-writable, because it is shared and sticky by design.
 */
const OS_TEMP_ROOT = os.tmpdir();
const TEMP_ROOT = fs.realpathSync(OS_TEMP_ROOT);

/**
 * Whether an existing directory is a safe parent for forensic data.
 * @param stats - `lstat` result for the nearest existing ancestor.
 * @returns True when it is a real directory no untrusted user can write to.
 */
function isSafeBase(stats: fs.Stats): boolean {
  if (!stats.isDirectory()) return false;
  if ((stats.mode & UNSAFE_BITS) !== 0) return false;
  return UID === undefined || stats.uid === UID || stats.uid === 0;
}

/**
 * Find the nearest existing ancestor of an absolute path.
 * @param target - Absolute path.
 * @returns The nearest existing ancestor.
 */
function nearestExisting(target: string): string {
  let probe = target;
  while (!fs.existsSync(probe)) {
    probe = path.dirname(probe);
  }
  return probe;
}

/**
 * List the missing components from an existing ancestor down to a target.
 * @param base - Existing ancestor.
 * @param target - Desired path.
 * @returns Missing paths in creation order.
 */
function missingComponents(base: string, target: string): readonly string[] {
  const parts: string[] = [];
  let probe = target;
  while (probe !== base) {
    parts.push(probe);
    probe = path.dirname(probe);
  }
  return parts.reverse();
}

/**
 * Whether a failure means the component already exists.
 * @param error - Thrown value.
 * @returns True for an `EEXIST` filesystem error.
 */
function isAlreadyExists(error: unknown): boolean {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return code === 'EEXIST';
}

/**
 * Tighten one verified component to `0700` when it is group/world-accessible.
 * @param component - Component to tighten.
 * @param stats - `lstat` snapshot of the component.
 * @returns True once tightened.
 */
function tightenComponentMode(component: string, stats: fs.Stats): true {
  if ((stats.mode & 0o077) !== 0) fs.chmodSync(component, 0o700);
  return true;
}

/**
 * Verify one component is a real directory owned by the current user.
 * @param component - Component to verify.
 * @returns True once verified.
 */
function assertPrivateComponent(component: string): true {
  const stats = fs.lstatSync(component);
  if (!stats.isDirectory()) {
    throw new ScraperError(`runs root component is not a directory: ${component}`);
  }
  if (UID !== undefined && stats.uid !== UID) {
    throw new ScraperError(`runs root component is not owned by the current user: ${component}`);
  }
  return tightenComponentMode(component, stats);
}

/**
 * Check one existing ancestor cannot be replaced by another user.
 * @param component - Existing path component.
 * @returns True when the component is the temp root or a safe owner.
 */
function assertSafeAncestor(component: string): true {
  if (component === TEMP_ROOT) return true;
  const stats = fs.lstatSync(component);
  if (!isSafeBase(stats)) {
    throw new ScraperError(`runs root ancestor is not safe: ${component}`);
  }
  return true;
}

/**
 * Return the parent path component, or false at the filesystem root.
 * @param component - Path component.
 * @returns Parent path, or false at the root.
 */
function nextAncestor(component: string): string | false {
  const parent = path.dirname(component);
  return parent === component ? false : parent;
}

/**
 * Validate every existing ancestor back to the filesystem root.
 * @param target - Canonical nearest existing ancestor.
 * @returns True once the whole chain is safe.
 */
function assertSafeChain(target: string): true {
  let probe: string | false = target;
  while (probe !== false) {
    assertSafeAncestor(probe);
    probe = nextAncestor(probe);
  }
  return true;
}

/**
 * Ignore an already-exists failure; rethrow every other filesystem error.
 * @param error - Thrown value.
 * @returns True when the component already existed.
 */
function rethrowUnlessExists(error: unknown): true {
  if (!isAlreadyExists(error)) throw error;
  return true;
}

/**
 * Create one missing component or accept an existing one, then verify it.
 * @param component - Component to create.
 * @returns True once the component is private.
 */
function makePrivateComponent(component: string): true {
  try {
    fs.mkdirSync(component, { mode: 0o700 });
  } catch (error) {
    rethrowUnlessExists(error);
  }
  return assertPrivateComponent(component);
}

/**
 * Resolve a runs root to its canonical path before any component is created.
 * @param root - Configured runs root.
 * @returns Canonical absolute path.
 */
function canonicalTarget(root: string): string {
  const target = path.resolve(root);
  const base = nearestExisting(target);
  const realBase = fs.realpathSync(base);
  const relative = path.relative(base, target);
  return relative.length === 0 ? realBase : path.join(realBase, relative);
}

/**
 * Create and verify every missing component under an existing ancestor.
 * @param target - Canonical runs root.
 * @returns True once each component is a real, private, user-owned directory.
 */
function provisionRoot(target: string): true {
  const base = nearestExisting(target);
  assertSafeChain(base);
  const missing = missingComponents(base, target);
  missing.forEach(makePrivateComponent);
  return assertPrivateComponent(target);
}

/**
 * Provision a private runs root before the run folder is created under it.
 * @param root - Configured runs root.
 * @returns Canonical root once every component is a real, private, user-owned
 *   directory.
 */
function ensurePrivateRunRoot(root: string): RunRootPath {
  if (UID === undefined) return path.resolve(root) as RunRootPath;
  const target = canonicalTarget(root);
  provisionRoot(target);
  return target as RunRootPath;
}

export default ensurePrivateRunRoot;
