/**
 * AtomicReplace — the cache write must survive a destination that Windows
 * briefly reports as held by another process.
 *
 * <p>The contention cannot be produced on POSIX, where `rename` succeeds
 * regardless of open descriptors, so the rename primitive is injected and
 * scripted to fail the way libuv reports a sharing violation. The last test
 * pins the real-filesystem overwrite, which is the part that needs no
 * simulation.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { RenameFn } from '../E2eReal/AtomicReplace.js';
import { replaceAtomically } from '../E2eReal/AtomicReplace.js';

/** Bytes the replacement carries. */
const PAYLOAD = 'SYNTHETIC-REPLACEMENT';

/** Bytes the destination held beforehand. */
const PRIOR = 'SYNTHETIC-PRIOR';

/** Scratch dir for the filesystem-backed test. */
let sandbox = '';

/** A scripted rename together with the attempt counter it increments. */
interface IScriptedRename {
  /** The double to inject in place of `fs.rename`. */
  readonly rename: RenameFn;
  /** Mutable attempt tally. */
  readonly calls: { count: number };
}

/**
 * Build a rename that reports contention a fixed number of times first.
 * @param failures - How many attempts fail before one succeeds.
 * @param code - Errno the scripted failures carry.
 * @returns The rename double plus its attempt counter.
 */
function renameFailing(failures: number, code: string): IScriptedRename {
  const calls = { count: 0 };
  /**
   * Stand in for `fs.rename`.
   * @returns Resolved once the scripted failures are exhausted.
   */
  const rename = (): Promise<void> => {
    calls.count += 1;
    if (calls.count > failures) return Promise.resolve();
    const error: NodeJS.ErrnoException = new Error(`scripted ${code}`);
    error.code = code;
    return Promise.reject(error);
  };
  return { rename, calls };
}

beforeEach(async () => {
  const root = os.tmpdir();
  const prefix = path.join(root, 'atomic-replace-');
  sandbox = await fs.mkdtemp(prefix);
});

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('AtomicReplace — a destination another process is holding', () => {
  it('rides out a sharing violation and still lands the payload', async () => {
    const scripted = renameFailing(2, 'EBUSY');
    const wasPlaced = await replaceAtomically({
      from: 'from',
      to: 'to',
      rename: scripted.rename,
    });
    expect(wasPlaced).toBe(true);
  });

  it('keeps retrying rather than dropping the write on the first refusal', async () => {
    const scripted = renameFailing(2, 'EBUSY');
    await replaceAtomically({ from: 'from', to: 'to', rename: scripted.rename });
    expect(scripted.calls.count).toBe(3);
  });

  it('rides out ERROR_ACCESS_DENIED, which libuv reports as EPERM', async () => {
    const scripted = renameFailing(1, 'EPERM');
    const wasPlaced = await replaceAtomically({
      from: 'from',
      to: 'to',
      rename: scripted.rename,
    });
    expect(wasPlaced).toBe(true);
  });
});

describe('AtomicReplace — failures a retry cannot fix', () => {
  it('surfaces a missing source immediately instead of masking it', async () => {
    const scripted = renameFailing(99, 'ENOENT');
    const attempt = replaceAtomically({ from: 'from', to: 'to', rename: scripted.rename });
    await expect(attempt).rejects.toThrow('scripted ENOENT');
  });

  it('does not burn the retry budget on a non-contention failure', async () => {
    const scripted = renameFailing(99, 'ENOENT');
    await replaceAtomically({ from: 'from', to: 'to', rename: scripted.rename }).catch(
      () => undefined,
    );
    expect(scripted.calls.count).toBe(1);
  });

  it('gives up once the attempt budget is spent', async () => {
    const scripted = renameFailing(99, 'EBUSY');
    const attempt = replaceAtomically({ from: 'from', to: 'to', rename: scripted.rename });
    await expect(attempt).rejects.toThrow('scripted EBUSY');
  });
});

describe('AtomicReplace — the real filesystem', () => {
  it('overwrites an existing destination without unlinking it first', async () => {
    const from = path.join(sandbox, 'source');
    const to = path.join(sandbox, 'destination');
    await fs.writeFile(to, PRIOR, 'utf8');
    await fs.writeFile(from, PAYLOAD, 'utf8');
    await replaceAtomically({ from, to });
    const landed = await fs.readFile(to, 'utf8');
    expect(landed).toBe(PAYLOAD);
  });
});
