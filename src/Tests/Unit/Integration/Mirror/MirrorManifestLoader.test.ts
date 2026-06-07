/**
 * Unit tests for MirrorManifestLoader. Uses a temporary directory with
 * a minimal in-memory manifest to exercise the validator without
 * committing fixtures.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadMirrorManifest } from '../../../Integration/Mirror/MirrorManifestLoader.js';

const BANK_ID = 'unittestbank';

/** Wrapper handle for a temp fixtures root + tear-down callback. */
interface IFixturesRoot {
  readonly fixturesRoot: string;
  readonly cleanup: () => boolean;
}

/**
 * Create a temporary directory under the system temp folder.
 *
 * @param prefix - Directory name prefix.
 * @returns Absolute path of the created temp directory.
 */
function createTempDir(prefix: string): string {
  const sysTemp = tmpdir();
  const fullPrefix = join(sysTemp, prefix);
  return mkdtempSync(fullPrefix);
}

/**
 * Build a cleanup callback that recursively removes a directory.
 *
 * @param root - Root directory path to remove on cleanup.
 * @returns Callback returning true after deletion.
 */
function makeDirCleanup(root: string): () => boolean {
  return (): boolean => {
    rmSync(root, { recursive: true, force: true });
    return true;
  };
}

/**
 * Create a temporary fixtures root with the bank directory pre-made.
 *
 * @returns Handle exposing the root + cleanup.
 */
function setupRoot(): IFixturesRoot {
  const root = createTempDir('mirror-loader-test-');
  const bankDir = join(root, BANK_ID);
  mkdirSync(bankDir, { recursive: true });
  return { fixturesRoot: root, cleanup: makeDirCleanup(root) };
}

/**
 * Write a raw manifest string into the temporary fixtures root.
 *
 * @param fixturesRoot - Temp fixtures root.
 * @param raw - JSON-stringified manifest body.
 * @returns Always true.
 */
function writeManifest(fixturesRoot: string, raw: string): boolean {
  const manifestPath = join(fixturesRoot, BANK_ID, 'manifest.json');
  writeFileSync(manifestPath, raw, 'utf8');
  return true;
}

const VALID_MANIFEST = JSON.stringify({
  bankId: BANK_ID,
  originUrl: 'https://bank.example.com',
  startPhase: 'INIT',
  endPhase: 'TERMINATE',
  transitions: [
    {
      phase: 'INIT',
      method: 'GET',
      urlPattern: '/init',
      response: { status: 200, contentType: 'text/html', bodyFile: 'init.html' },
      advanceTo: 'HOME',
    },
  ],
} as const);

describe('loadMirrorManifest — happy path', () => {
  it('parses a minimal valid manifest', () => {
    const fixtures = setupRoot();
    try {
      writeManifest(fixtures.fixturesRoot, VALID_MANIFEST);
      const manifest = loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot });
      expect(manifest.bankId).toBe(BANK_ID);
      expect(manifest.startPhase).toBe('INIT');
      expect(manifest.endPhase).toBe('TERMINATE');
      expect(manifest.transitions).toHaveLength(1);
      expect(manifest.transitions[0].phase).toBe('INIT');
      expect(manifest.transitions[0].advanceTo).toBe('HOME');
    } finally {
      fixtures.cleanup();
    }
  });

  it('upper-cases method input', () => {
    const fixtures = setupRoot();
    try {
      const raw = JSON.stringify({
        bankId: BANK_ID,
        originUrl: 'https://bank.example.com',
        startPhase: 'INIT',
        endPhase: 'TERMINATE',
        transitions: [
          {
            phase: 'INIT',
            method: 'post',
            urlPattern: '/x',
            response: { status: 200, contentType: 'application/json', bodyFile: 'x.json' },
          },
        ],
      });
      writeManifest(fixtures.fixturesRoot, raw);
      const manifest = loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot });
      expect(manifest.transitions[0].method).toBe('POST');
    } finally {
      fixtures.cleanup();
    }
  });
});

describe('loadMirrorManifest — invalid inputs', () => {
  it('rejects non-JSON', () => {
    const fixtures = setupRoot();
    try {
      writeManifest(fixtures.fixturesRoot, 'not-json{');
      expect(() =>
        loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot }),
      ).toThrow(/not valid JSON/);
    } finally {
      fixtures.cleanup();
    }
  });

  it('rejects unknown HTTP method', () => {
    const fixtures = setupRoot();
    try {
      const raw = JSON.stringify({
        bankId: BANK_ID,
        originUrl: 'https://x',
        startPhase: 'INIT',
        endPhase: 'TERMINATE',
        transitions: [
          {
            phase: 'INIT',
            method: 'CONNECT',
            urlPattern: '/x',
            response: { status: 200, contentType: 'text/html', bodyFile: 'a.html' },
          },
        ],
      });
      writeManifest(fixtures.fixturesRoot, raw);
      expect(() =>
        loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot }),
      ).toThrow(/not in allowed set/);
    } finally {
      fixtures.cleanup();
    }
  });

  it('rejects invalid status code', () => {
    const fixtures = setupRoot();
    try {
      const raw = JSON.stringify({
        bankId: BANK_ID,
        originUrl: 'https://x',
        startPhase: 'INIT',
        endPhase: 'TERMINATE',
        transitions: [
          {
            phase: 'INIT',
            method: 'GET',
            urlPattern: '/x',
            response: { status: 99, contentType: 'text/html', bodyFile: 'a.html' },
          },
        ],
      });
      writeManifest(fixtures.fixturesRoot, raw);
      expect(() =>
        loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot }),
      ).toThrow(/3-digit integer/);
    } finally {
      fixtures.cleanup();
    }
  });

  it('rejects unknown resourceType', () => {
    const fixtures = setupRoot();
    try {
      const raw = JSON.stringify({
        bankId: BANK_ID,
        originUrl: 'https://x',
        startPhase: 'INIT',
        endPhase: 'TERMINATE',
        transitions: [
          {
            phase: 'INIT',
            method: 'GET',
            urlPattern: '/x',
            resourceType: 'eventsource',
            response: { status: 200, contentType: 'text/html', bodyFile: 'a.html' },
          },
        ],
      });
      writeManifest(fixtures.fixturesRoot, raw);
      expect(() =>
        loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot }),
      ).toThrow(/not in allowed resource-type set/);
    } finally {
      fixtures.cleanup();
    }
  });

  it('rejects unknown phase', () => {
    const fixtures = setupRoot();
    try {
      const raw = JSON.stringify({
        bankId: BANK_ID,
        originUrl: 'https://x',
        startPhase: 'NOPE',
        endPhase: 'TERMINATE',
        transitions: [],
      });
      writeManifest(fixtures.fixturesRoot, raw);
      expect(() =>
        loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot }),
      ).toThrow(/is not a canonical IntegrationPhase/);
    } finally {
      fixtures.cleanup();
    }
  });

  it('rejects postData with shape other than json|form', () => {
    const fixtures = setupRoot();
    try {
      const raw = JSON.stringify({
        bankId: BANK_ID,
        originUrl: 'https://x',
        startPhase: 'INIT',
        endPhase: 'TERMINATE',
        transitions: [
          {
            phase: 'INIT',
            method: 'POST',
            urlPattern: '/x',
            postData: { shape: 'xml', expectations: {} },
            response: { status: 200, contentType: 'text/html', bodyFile: 'a.html' },
          },
        ],
      });
      writeManifest(fixtures.fixturesRoot, raw);
      expect(() =>
        loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot }),
      ).toThrow(/'json' or 'form'/);
    } finally {
      fixtures.cleanup();
    }
  });

  it('rejects non-string in expectations map', () => {
    const fixtures = setupRoot();
    try {
      const raw = JSON.stringify({
        bankId: BANK_ID,
        originUrl: 'https://x',
        startPhase: 'INIT',
        endPhase: 'TERMINATE',
        transitions: [
          {
            phase: 'INIT',
            method: 'POST',
            urlPattern: '/x',
            postData: { shape: 'json', expectations: { a: 1 } },
            response: { status: 200, contentType: 'text/html', bodyFile: 'a.html' },
          },
        ],
      });
      writeManifest(fixtures.fixturesRoot, raw);
      expect(() =>
        loadMirrorManifest({ bankId: BANK_ID, fixturesRoot: fixtures.fixturesRoot }),
      ).toThrow(/must be a string/);
    } finally {
      fixtures.cleanup();
    }
  });
});
