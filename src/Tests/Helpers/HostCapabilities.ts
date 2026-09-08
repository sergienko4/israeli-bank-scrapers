/**
 * What the host running the suite is actually able to do.
 *
 * <p>A few suites exercise POSIX-only facilities directly. Rather than let
 * them fail on a host that could never have run them, they stand down — but
 * only where the facility is unreachable *by construction*. Standing down
 * because a facility merely looks unavailable would let the assertion fall
 * dormant on macOS or Linux without anyone noticing.
 */

/**
 * Whether the platform is Windows.
 * @param platform - A `process.platform` value.
 * @returns True on Windows.
 */
function isWindows(platform: string): boolean {
  return platform === 'win32';
}

/**
 * Whether real symlinks can be created without special privileges.
 *
 * <p>Windows refuses `symlinkSync` with `EPERM` unless the user holds
 * `SeCreateSymbolicLinkPrivilege` — Developer Mode or an elevated shell — so
 * a suite that creates links cannot be required there.
 * @param platform - A `process.platform` value.
 * @returns True when symlink creation is dependable.
 */
export function canCreateSymlinks(platform: string): boolean {
  return !isWindows(platform);
}

/**
 * Whether bash can be reached at an absolute POSIX path.
 *
 * <p>Git for Windows installs bash under `Program Files`, so no amount of
 * extra candidate paths makes `/bin/bash` resolve there.
 * @param platform - A `process.platform` value.
 * @returns True when POSIX bash paths are meaningful.
 */
export function canRunPosixBash(platform: string): boolean {
  return !isWindows(platform);
}
