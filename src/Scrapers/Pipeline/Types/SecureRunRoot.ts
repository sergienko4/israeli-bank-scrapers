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
 * Check that the nearest existing ancestor cannot be replaced by another user.
 * @param base - Nearest existing ancestor.
 * @returns True when the ancestor is the platform temp root or a safe owner.
 */
function assertSafeBase(base: string): true {
  const stats = fs.lstatSync(base);
  const realBase = fs.realpathSync(base);
  const isTempRoot = realBase === TEMP_ROOT;
  if (!isTempRoot && !isSafeBase(stats)) {
    throw new ScraperError(`runs root parent is not safe: ${base}`);
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
 * Provision a private runs root before the run folder is created under it.
 * @param root - Configured runs root.
 * @returns True once every component is a real, private, user-owned directory.
 */
function ensurePrivateRunRoot(root: string): true {
  if (UID === undefined) return true;
  const target = path.resolve(root);
  const base = nearestExisting(target);
  assertSafeBase(base);
  const missing = missingComponents(base, target);
  missing.forEach(makePrivateComponent);
  return assertPrivateComponent(target);
}

export default ensurePrivateRunRoot;
