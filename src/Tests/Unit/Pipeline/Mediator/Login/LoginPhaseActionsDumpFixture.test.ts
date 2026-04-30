/**
 * Unit tests for the DUMP_FIXTURES_DIR-driven HTML dumping helpers in
 * LoginPhaseActions. Exercises writeFrameHtml end-to-end against a real
 * tmp directory, the writeIframeSnapshot atom, and the top-level
 * dumpFixtureHtml guard-clause branches (env unset, browser absent).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Frame, Page as BrowserPage } from 'playwright-core';

import { CompanyTypes } from '../../../../../Definitions.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  dumpFixtureHtml,
  writeFrameHtml,
  writeIframeSnapshot,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/**
 * Build a single Frame-like object that resolves to the supplied HTML.
 * @param html - Captured HTML for this frame.
 * @returns Frame-like stub.
 */
function makeFrameStub(html: string): Frame {
  return {
    /**
     * Return the captured HTML.
     * @returns HTML string.
     */
    content: async (): Promise<string> => {
      await Promise.resolve();
      return html;
    },
  } as unknown as Frame;
}

/**
 * Build a BrowserPage stub with a main frame + optional child iframes.
 * @param main - Main-frame HTML.
 * @param childFrames - Iframe HTML (empty strings stay empty).
 * @returns BrowserPage-ish stub usable by writeFrameHtml.
 */
function makePage(main: string, childFrames: readonly string[]): BrowserPage {
  const mainFrame = makeFrameStub(main);
  const children = childFrames.map((html): Frame => makeFrameStub(html));
  const all = [mainFrame, ...children];
  return {
    /**
     * Return the main frame stub.
     * @returns Main frame.
     */
    mainFrame: (): Frame => mainFrame,
    /**
     * Return all frames on this stub.
     * @returns Frames array.
     */
    frames: (): readonly Frame[] => all,
    /**
     * Return the main-frame HTML.
     * @returns Main-frame HTML.
     */
    content: async (): Promise<string> => {
      await Promise.resolve();
      return main;
    },
  } as unknown as BrowserPage;
}

/**
 * Build a pipeline context that references the supplied BrowserPage.
 * @param pageStub - BrowserPage stub.
 * @returns IPipelineContext with populated browser slot.
 */
function makeCtxWithPage(pageStub: BrowserPage): IPipelineContext {
  const base = makeMockContext();
  return {
    ...base,
    browser: some({
      page: pageStub,
      browser: {},
      context: {},
    }) as unknown as IPipelineContext['browser'],
    companyId: CompanyTypes.OneZero,
  };
}

/**
 * Create a unique tmp directory for one test.
 * @returns Absolute path of the created directory.
 */
async function makeTempDir(): Promise<string> {
  const tmpRoot = os.tmpdir();
  const prefix = path.join(tmpRoot, 'ibs-fixture-test-');
  return fs.mkdtemp(prefix);
}

describe('LoginPhaseActions dumpFixtureHtml guard', () => {
  afterEach((): void => {
    delete process.env.DUMP_FIXTURES_DIR;
  });

  it('is a no-op when DUMP_FIXTURES_DIR is unset', async (): Promise<void> => {
    const pageStub = makePage('<html></html>', []);
    const ctx = makeCtxWithPage(pageStub);
    const isOk = await dumpFixtureHtml(ctx, 'any-label');
    expect(isOk).toBe(true);
  });

  it('is a no-op when DUMP_FIXTURES_DIR is empty', async (): Promise<void> => {
    process.env.DUMP_FIXTURES_DIR = '';
    const pageStub = makePage('<html></html>', []);
    const ctx = makeCtxWithPage(pageStub);
    const isOk = await dumpFixtureHtml(ctx, 'any-label');
    expect(isOk).toBe(true);
  });

  it('is a no-op when browser slot is absent', async (): Promise<void> => {
    process.env.DUMP_FIXTURES_DIR = '/tmp/never-used';
    const base = makeMockContext();
    const isOk = await dumpFixtureHtml(base, 'any-label');
    expect(isOk).toBe(true);
  });
});

describe('LoginPhaseActions dumpFixtureHtml integration', () => {
  afterEach((): void => {
    delete process.env.DUMP_FIXTURES_DIR;
  });

  it('writes main + iframe HTML under <DUMP_FIXTURES_DIR>/<bank>/', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    process.env.DUMP_FIXTURES_DIR = rootDir;
    const pageStub = makePage('<html>main</html>', [
      '<iframe-0></iframe-0>',
      '<iframe-1></iframe-1>',
    ]);
    const ctx = makeCtxWithPage(pageStub);
    const isOk = await dumpFixtureHtml(ctx, 'login-post-v2');
    expect(isOk).toBe(true);
    const bank = CompanyTypes.OneZero;
    const bankDir = path.join(rootDir, bank);
    const mainPath = path.join(bankDir, 'login-post-v2.html');
    const mainBytes = await fs.readFile(mainPath, 'utf8');
    expect(mainBytes).toBe('<html>main</html>');
    const iframe0Path = path.join(bankDir, 'login-post-v2-iframe-0.html');
    const iframe0 = await fs.readFile(iframe0Path, 'utf8');
    expect(iframe0).toBe('<iframe-0></iframe-0>');
    const iframe1Path = path.join(bankDir, 'login-post-v2-iframe-1.html');
    const iframe1 = await fs.readFile(iframe1Path, 'utf8');
    expect(iframe1).toBe('<iframe-1></iframe-1>');
  });
});

describe('LoginPhaseActions writeFrameHtml direct', () => {
  it('creates the bankDir and writes main + snapshots', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    const bankDir = path.join(rootDir, 'onezero');
    const pageStub = makePage('<html>MAIN</html>', ['<a></a>']);
    const ctx = makeCtxWithPage(pageStub);
    const isOk = await writeFrameHtml({ page: pageStub, bankDir, label: 'step1', input: ctx });
    expect(isOk).toBe(true);
    const mainPath = path.join(bankDir, 'step1.html');
    const mainBytes = await fs.readFile(mainPath, 'utf8');
    expect(mainBytes).toBe('<html>MAIN</html>');
    const iframe0Path = path.join(bankDir, 'step1-iframe-0.html');
    const iframe0 = await fs.readFile(iframe0Path, 'utf8');
    expect(iframe0).toBe('<a></a>');
  });
});

describe('LoginPhaseActions writeIframeSnapshot atom', () => {
  it('writes one iframe file verbatim with the supplied idx', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    const pageStub = makePage('<html></html>', []);
    const ctx = makeCtxWithPage(pageStub);
    await writeIframeSnapshot({
      fs,
      outer: { page: pageStub, bankDir: rootDir, label: 'atom', input: ctx },
      snap: { html: '<snap>', idx: 7 },
    });
    const targetPath = path.join(rootDir, 'atom-iframe-7.html');
    const bytes = await fs.readFile(targetPath, 'utf8');
    expect(bytes).toBe('<snap>');
    // Touch ScraperError so the import is not unused (guards against
    // accidental `throw new Error(...)` reintroduction in this file).
    void ScraperError;
  });
});
