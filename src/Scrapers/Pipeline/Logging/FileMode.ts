/**
 * Owner-only mode enforcement for an open log descriptor.
 *
 * <p>The open-mode argument to `fs.openSync` applies only when the file is
 * created. A pre-existing `pipeline.log` must be tightened explicitly, and a
 * descriptor whose mode change fails must be closed rather than leaked.
 */

import * as fs from 'node:fs';

/**
 * Tighten a descriptor to `0600`, closing it when the mode change fails.
 * Windows has no equivalent owner/group/other model, so it is a no-op there.
 * @param fd - Open append descriptor.
 * @returns True once the mode is owner-only (or on Windows).
 */
export default function tightenOrClose(fd: number): true {
  if (process.platform === 'win32') return true;
  try {
    fs.fchmodSync(fd, 0o600);
    return true;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
