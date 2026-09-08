/**
 * Host capability predicates — the excuse must stay narrow.
 *
 * <p>Two suites reach for POSIX-only facilities: absolute `/bin/bash` paths
 * and real symlinks. Windows can satisfy neither by construction, so those
 * suites stand down there. The danger is the excuse growing: a predicate that
 * also stood down whenever the facility merely *appeared* missing would let
 * the assertions fall silently dormant on macOS and Linux, which is precisely
 * the vacuousness those suites exist to prevent. These specs pin the excuse
 * to Windows and nothing else.
 */
import { canCreateSymlinks, canRunPosixBash } from '../../Helpers/HostCapabilities.js';

/** Platforms that must never be excused from a POSIX-only assertion. */
const POSIX_PLATFORMS = ['darwin', 'linux', 'freebsd', 'openbsd', 'aix'] as const;

describe('HostCapabilities — only Windows is excused', () => {
  it('HOST-CAP-1 every POSIX platform must still create symlinks', () => {
    const verdicts = POSIX_PLATFORMS.map(name => canCreateSymlinks(name));
    const expected = POSIX_PLATFORMS.map(() => true);

    expect(verdicts).toEqual(expected);
  });

  it('HOST-CAP-2 every POSIX platform must still run bash', () => {
    const verdicts = POSIX_PLATFORMS.map(name => canRunPosixBash(name));
    const expected = POSIX_PLATFORMS.map(() => true);

    expect(verdicts).toEqual(expected);
  });

  it('HOST-CAP-3 Windows is excused from both', () => {
    const canLink = canCreateSymlinks('win32');
    const canBash = canRunPosixBash('win32');

    expect({ canLink, canBash }).toEqual({ canLink: false, canBash: false });
  });
});
