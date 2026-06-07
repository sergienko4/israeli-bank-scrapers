/**
 * Unit tests for HarLoader.
 *
 * Validates that:
 * - well-formed Playwright HAR files load into a typed {@link IHarFile};
 * - missing `log` / non-array `entries` / non-object root all throw a
 *   single readable {@link ScraperError} message;
 * - per-entry shape (missing `request`/`response`) is caught.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { loadHarEntries, loadHarFile } from '../../../Integration/Simulator/HarLoader.js';

/** Minimal valid HAR JSON used as a baseline. */
const VALID_HAR = {
  log: {
    version: '1.2',
    creator: { name: 'jest', version: '1.0' },
    entries: [
      {
        request: { method: 'GET', url: 'https://bank.example/api', headers: [], queryString: [] },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [],
          content: { mimeType: 'text/html' },
        },
      },
    ],
  },
} as const;

/** Handle for one isolated test workspace. */
interface ITempHar {
  readonly path: string;
  readonly cleanup: () => boolean;
}

/**
 * Build a cleanup callback that recursively removes `dir`.
 *
 * @param dir - Directory to remove.
 * @returns Callback returning true after deletion.
 */
function makeCleanup(dir: string): () => boolean {
  return (): boolean => {
    rmSync(dir, { recursive: true, force: true });
    return true;
  };
}

/**
 * Create a temp .har file containing `raw`.
 *
 * @param raw - JSON body (will be `JSON.stringify`-ed).
 * @returns Path + cleanup callback.
 */
function makeTempHar(raw: unknown): ITempHar {
  const sysTemp = tmpdir();
  const prefix = join(sysTemp, 'har-loader-test-');
  const dir = mkdtempSync(prefix);
  const path = join(dir, 'capture.har');
  const body = JSON.stringify(raw);
  writeFileSync(path, body, 'utf8');
  return { path, cleanup: makeCleanup(dir) };
}

describe('HarLoader', () => {
  describe('loadHarFile (happy path)', () => {
    it('parses + returns the typed IHarFile', () => {
      const t = makeTempHar(VALID_HAR);
      try {
        const file = loadHarFile(t.path);
        const firstEntry = file.log.entries[0];
        expect(file.log.entries.length).toBe(1);
        expect(firstEntry.request.method).toBe('GET');
        expect(firstEntry.response.status).toBe(200);
      } finally {
        t.cleanup();
      }
    });
  });

  describe('loadHarEntries (convenience)', () => {
    it('returns just the entries array', () => {
      const t = makeTempHar(VALID_HAR);
      try {
        const entries = loadHarEntries(t.path);
        const firstUrl = entries[0].request.url;
        expect(entries.length).toBe(1);
        expect(firstUrl).toBe('https://bank.example/api');
      } finally {
        t.cleanup();
      }
    });
  });

  describe('validation errors', () => {
    it('throws ScraperError on non-object root', () => {
      const t = makeTempHar('not-an-object');
      try {
        expect(() => loadHarFile(t.path)).toThrow(ScraperError);
        expect(() => loadHarFile(t.path)).toThrow(/root is not an object/);
      } finally {
        t.cleanup();
      }
    });

    it('throws ScraperError on missing log', () => {
      const t = makeTempHar({ noLog: true });
      try {
        expect(() => loadHarFile(t.path)).toThrow(/log is not an object/);
      } finally {
        t.cleanup();
      }
    });

    it('throws ScraperError on non-array entries', () => {
      const t = makeTempHar({ log: { entries: 'oops' } });
      try {
        expect(() => loadHarFile(t.path)).toThrow(/log\.entries is not an array/);
      } finally {
        t.cleanup();
      }
    });

    it('throws ScraperError on entry missing request', () => {
      const bad = { log: { entries: [{ response: {} }] } };
      const t = makeTempHar(bad);
      try {
        expect(() => loadHarFile(t.path)).toThrow(/entries\[0\]\.request is not an object/);
      } finally {
        t.cleanup();
      }
    });

    it('throws ScraperError on entry missing response', () => {
      const bad = { log: { entries: [{ request: {} }] } };
      const t = makeTempHar(bad);
      try {
        expect(() => loadHarFile(t.path)).toThrow(/entries\[0\]\.response is not an object/);
      } finally {
        t.cleanup();
      }
    });
  });
});
