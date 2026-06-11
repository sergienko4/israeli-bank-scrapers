/**
 * Unit coverage for {@link MirrorFrameRoutes}. Validates:
 * - missing frames.json returns empty-singleton maps,
 * - well-formed manifests build the byUrl map keyed on origin+pathname,
 * - duplicate hosts with distinct bodies trip the {@link HOST_AMBIGUOUS}
 *   sentinel so the consumer never serves wrong content,
 * - {@link normalizeFrameUrl} strips query/hash variance,
 * - top-frame / about:blank rows are filtered out by the loader.
 *
 * Tests redirect into an OS tmpdir via {@link loadFrameRoutesFromRoot}
 * so they never touch the committed `src/Tests/Integration/fixtures`
 * tree (keeps the repo deterministic across test runs).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HOST_AMBIGUOUS,
  loadFrameRoutes,
  loadFrameRoutesFromRoot,
  normalizeFrameUrl,
  safeFrameHost,
} from '../../../Integration/Helpers/MirrorFrameRoutes.js';

const STEP_NAME = 'step';
const SYS_TMP = tmpdir();
const SANDBOX_PREFIX = 'mfr-test-';

/** Per-test sandbox: root + bank-step dir + cleanup callback. */
interface ISandbox {
  readonly root: string;
  readonly stepDir: string;
  readonly cleanup: () => boolean;
}

/**
 * Build a cleanup callback that recursively removes the temp root.
 * @param root - Root directory to remove on cleanup.
 * @returns Callback returning true after deletion.
 */
function makeCleanup(root: string): () => boolean {
  return (): boolean => {
    rmSync(root, { recursive: true, force: true });
    return true;
  };
}

/**
 * Create a fresh temp root with the bank+step subdirectory pre-made.
 * @returns Sandbox handle.
 */
function createSandbox(): ISandbox {
  const prefix = join(SYS_TMP, SANDBOX_PREFIX);
  const root = mkdtempSync(prefix);
  const stepDir = join(root, STEP_NAME);
  mkdirSync(stepDir, { recursive: true });
  return { root, stepDir, cleanup: makeCleanup(root) };
}

/**
 * Write the frames.json manifest inside the sandbox step dir.
 * @param sandbox - Sandbox handle from {@link createSandbox}.
 * @param raw - JSON-stringified manifest payload.
 * @returns Always true.
 */
function writeManifest(sandbox: ISandbox, raw: string): boolean {
  const manifestPath = join(sandbox.stepDir, 'frames.json');
  writeFileSync(manifestPath, raw, 'utf8');
  return true;
}

/**
 * Write a single frame body file into the sandbox step dir.
 * @param sandbox - Sandbox handle.
 * @param fileName - Frame file name (matches a manifest row's `file`).
 * @param body - HTML body to write.
 * @returns Always true.
 */
function writeFrameBody(sandbox: ISandbox, fileName: string, body: string): boolean {
  const bodyPath = join(sandbox.stepDir, fileName);
  writeFileSync(bodyPath, body, 'utf8');
  return true;
}

/**
 * Build a fresh routable manifest row list.
 * @returns Manifest row array (top + child + about:blank).
 */
function buildRoutableManifestRows(): readonly unknown[] {
  return [
    { index: 0, name: '', url: 'https://top.example/', file: 'frame-0.html' },
    { index: 1, name: '', url: 'https://child.example/login', file: 'frame-1.html' },
    { index: 2, name: '', url: 'about:blank', file: 'frame-2.html' },
  ];
}

/**
 * Seed a sandbox with one top frame, one routable child frame, and one
 * about:blank frame so the loader has at least one filtered row to skip.
 * @param sandbox - Sandbox handle to write into.
 * @returns Always true.
 */
function seedRoutableFixture(sandbox: ISandbox): boolean {
  const rows = buildRoutableManifestRows();
  const raw = JSON.stringify(rows);
  writeManifest(sandbox, raw);
  writeFrameBody(sandbox, 'frame-0.html', '<html>top</html>');
  writeFrameBody(sandbox, 'frame-1.html', '<html>child</html>');
  return writeFrameBody(sandbox, 'frame-2.html', '<html>blank</html>');
}

/**
 * Build manifest rows for the host-ambiguity scenario.
 * @returns Two rows on the same host with differing bodies.
 */
function buildAmbiguousManifestRows(): readonly unknown[] {
  return [
    { index: 1, name: '', url: 'https://shared.example/a', file: 'frame-a.html' },
    { index: 2, name: '', url: 'https://shared.example/b', file: 'frame-b.html' },
  ];
}

/**
 * Seed two frames on the same host with DIFFERENT bodies — used to
 * trigger the HOST_AMBIGUOUS sentinel.
 * @param sandbox - Sandbox handle to write into.
 * @returns Always true.
 */
function seedAmbiguousHostFixture(sandbox: ISandbox): boolean {
  const rows = buildAmbiguousManifestRows();
  const raw = JSON.stringify(rows);
  writeManifest(sandbox, raw);
  writeFrameBody(sandbox, 'frame-a.html', '<html>A</html>');
  return writeFrameBody(sandbox, 'frame-b.html', '<html>B</html>');
}

/**
 * Build manifest rows for the same-content-host scenario.
 * @returns Two rows on the same host with identical bodies.
 */
function buildSameContentManifestRows(): readonly unknown[] {
  return [
    { index: 1, name: '', url: 'https://same.example/a', file: 'frame-a.html' },
    { index: 2, name: '', url: 'https://same.example/b', file: 'frame-b.html' },
  ];
}

/**
 * Seed two frames on the same host that emit the SAME body — host
 * fallback must remain valid (no ambiguity).
 * @param sandbox - Sandbox handle to write into.
 * @returns Always true.
 */
function seedSameContentHostFixture(sandbox: ISandbox): boolean {
  const rows = buildSameContentManifestRows();
  const raw = JSON.stringify(rows);
  writeManifest(sandbox, raw);
  writeFrameBody(sandbox, 'frame-a.html', '<html>X</html>');
  return writeFrameBody(sandbox, 'frame-b.html', '<html>X</html>');
}

/**
 * Build manifest rows where one row is valid and one is missing
 * required fields (so the loader has to filter).
 * @returns Mixed-validity manifest row array.
 */
function buildPartiallyInvalidManifestRows(): readonly unknown[] {
  return [
    { index: 1, name: '', url: 'https://good.example/x', file: 'frame-g.html' },
    { index: 'oops', url: 'https://bad.example/' },
  ];
}

/**
 * Seed a manifest with one valid row and one row missing the required
 * `file` field so the loader has to filter the bad row.
 * @param sandbox - Sandbox handle to write into.
 * @returns Always true.
 */
function seedPartiallyInvalidManifest(sandbox: ISandbox): boolean {
  const rows = buildPartiallyInvalidManifestRows();
  const raw = JSON.stringify(rows);
  writeManifest(sandbox, raw);
  return writeFrameBody(sandbox, 'frame-g.html', '<html>G</html>');
}

describe('normalizeFrameUrl', (): void => {
  it('returns origin+pathname (drops query+hash)', (): void => {
    const got = normalizeFrameUrl('https://example.com/path?q=1#frag');
    expect(got).toBe('https://example.com/path');
  });

  it('returns empty string for malformed input', (): void => {
    const got = normalizeFrameUrl('not-a-url');
    expect(got).toBe('');
  });

  it('does not throw on about:blank (filtered upstream)', (): void => {
    /**
     * Throwing wrapper used as the `expect().not.toThrow()` subject.
     * @returns Whatever normalizeFrameUrl returns (irrelevant here).
     */
    const subject = (): string => normalizeFrameUrl('about:blank');
    expect(subject).not.toThrow();
  });
});

describe('safeFrameHost', (): void => {
  it('returns host portion', (): void => {
    const host = safeFrameHost('https://example.com/path');
    expect(host).toBe('example.com');
  });

  it('returns empty string for malformed input', (): void => {
    const host = safeFrameHost('::');
    expect(host).toBe('');
  });
});

describe('loadFrameRoutesFromRoot — missing manifest', (): void => {
  it('returns empty maps when frames.json is absent', async (): Promise<void> => {
    const sandbox = createSandbox();
    try {
      const maps = await loadFrameRoutesFromRoot(sandbox.root, STEP_NAME);
      expect(maps.byUrl.size).toBe(0);
      expect(maps.byHost.size).toBe(0);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe('loadFrameRoutesFromRoot — well-formed manifest', (): void => {
  it('builds byUrl + byHost for routable frames and skips top + about:blank', async (): Promise<void> => {
    const sandbox = createSandbox();
    try {
      seedRoutableFixture(sandbox);
      const maps = await loadFrameRoutesFromRoot(sandbox.root, STEP_NAME);
      const childUrlBody = maps.byUrl.get('https://child.example/login');
      const childHostBody = maps.byHost.get('child.example');
      const hasTopUrl = maps.byUrl.has('https://top.example/');
      expect(childUrlBody).toBe('<html>child</html>');
      expect(childHostBody).toBe('<html>child</html>');
      expect(hasTopUrl).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe('loadFrameRoutesFromRoot — host ambiguity', (): void => {
  it('marks host as ambiguous when two frames share host with different bodies', async (): Promise<void> => {
    const sandbox = createSandbox();
    try {
      seedAmbiguousHostFixture(sandbox);
      const maps = await loadFrameRoutesFromRoot(sandbox.root, STEP_NAME);
      const hostBody = maps.byHost.get('shared.example');
      expect(maps.byUrl.size).toBe(2);
      expect(hostBody).toBe(HOST_AMBIGUOUS);
    } finally {
      sandbox.cleanup();
    }
  });

  it('keeps host body when both frames share the same content', async (): Promise<void> => {
    const sandbox = createSandbox();
    try {
      seedSameContentHostFixture(sandbox);
      const maps = await loadFrameRoutesFromRoot(sandbox.root, STEP_NAME);
      const hostBody = maps.byHost.get('same.example');
      expect(hostBody).toBe('<html>X</html>');
    } finally {
      sandbox.cleanup();
    }
  });
});

describe('loadFrameRoutesFromRoot — malformed manifest', (): void => {
  it('returns empty maps when JSON is not an array', async (): Promise<void> => {
    const sandbox = createSandbox();
    try {
      writeManifest(sandbox, '{"not":"array"}');
      const maps = await loadFrameRoutesFromRoot(sandbox.root, STEP_NAME);
      expect(maps.byUrl.size).toBe(0);
      expect(maps.byHost.size).toBe(0);
    } finally {
      sandbox.cleanup();
    }
  });

  it('skips rows missing required fields', async (): Promise<void> => {
    const sandbox = createSandbox();
    try {
      seedPartiallyInvalidManifest(sandbox);
      const maps = await loadFrameRoutesFromRoot(sandbox.root, STEP_NAME);
      const goodBody = maps.byUrl.get('https://good.example/x');
      const hasBadHost = maps.byHost.has('bad.example');
      expect(goodBody).toBe('<html>G</html>');
      expect(hasBadHost).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe('loadFrameRoutes — production bankId wrapper', (): void => {
  it('returns empty maps for an unknown bank (production path safe-noop)', async (): Promise<void> => {
    const maps = await loadFrameRoutes('unknown-bank-xyz-mfr', 'no-such-step');
    expect(maps.byUrl.size).toBe(0);
    expect(maps.byHost.size).toBe(0);
  });
});
