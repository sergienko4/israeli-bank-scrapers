/**
 * Unit tests for the DUMP_FIXTURES_DIR-driven HTML dumping helpers in
 * FixtureCapture. Exercises writeFrameHtml end-to-end against a real
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
} from '../../../../../Scrapers/Pipeline/Types/FixtureCapture.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Per-frame stub configuration: html string + optional url/name. */
interface IFrameStubConfig {
  readonly html: string;
  readonly url?: string;
  readonly name?: string;
}

/**
 * Build a single Frame-like object that resolves to the supplied HTML and
 * exposes optional url/name (for frame-metadata tests).
 * @param config - Frame stub config.
 * @returns Frame-like stub.
 */
function makeFrameStub(config: IFrameStubConfig): Frame {
  /**
   * Async getter that returns the configured HTML.
   * @returns Configured HTML string.
   */
  const contentFn = async (): Promise<string> => {
    await Promise.resolve();
    return config.html;
  };
  /**
   * Sync getter for the configured URL (empty string when absent).
   * @returns URL or empty string.
   */
  const urlFn = (): string => config.url ?? '';
  /**
   * Sync getter for the configured frame name (empty when absent).
   * @returns Name or empty string.
   */
  const nameFn = (): string => config.name ?? '';
  return { content: contentFn, url: urlFn, name: nameFn } as unknown as Frame;
}

/**
 * Convert a string-or-config child into a Frame stub.
 * Extracted to avoid the "no nested call" rule in higher-level builders.
 * @param child - Either an HTML string or full config.
 * @returns Frame-like stub.
 */
function toFrame(child: string | IFrameStubConfig): Frame {
  if (typeof child === 'string') return makeFrameStub({ html: child });
  return makeFrameStub(child);
}

/**
 * Build a BrowserPage stub with a main frame + optional child iframes.
 * Strings shorthand → just html. Objects → full config (url/name).
 * @param main - Main-frame HTML.
 * @param childFrames - Iframe HTML or full IFrameStubConfig.
 * @returns BrowserPage-ish stub usable by writeFrameHtml.
 */
function makePage(main: string, childFrames: readonly (string | IFrameStubConfig)[]): BrowserPage {
  const mainFrame = makeFrameStub({ html: main, url: 'https://example.test/main' });
  const children = childFrames.map(toFrame);
  const all = [mainFrame, ...children];
  /**
   * Sync getter for the main-frame stub.
   * @returns Main frame stub.
   */
  const mainFrameFn = (): Frame => mainFrame;
  /**
   * Sync getter for the frame list (main + children).
   * @returns Frame array.
   */
  const framesFn = (): readonly Frame[] => all;
  /**
   * Sync getter for the page URL.
   * @returns Page URL string.
   */
  const urlFn = (): string => 'https://example.test/main';
  /**
   * Async getter for the main-frame HTML.
   * @returns Main HTML.
   */
  const contentFn = async (): Promise<string> => {
    await Promise.resolve();
    return main;
  };
  return {
    mainFrame: mainFrameFn,
    frames: framesFn,
    url: urlFn,
    content: contentFn,
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

  it('writes main + iframe HTML + frames.json for login phase', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    process.env.DUMP_FIXTURES_DIR = rootDir;
    const pageStub = makePage('<html>main</html>', [
      { html: '<iframe-0></iframe-0>', url: 'https://example.test/f0', name: 'frame0' },
      { html: '<iframe-1></iframe-1>', url: 'https://example.test/f1', name: 'frame1' },
    ]);
    const ctx = makeCtxWithPage(pageStub);
    const isOk = await dumpFixtureHtml(ctx, 'login-pre-done');
    expect(isOk).toBe(true);
    const bankDir = path.join(rootDir, CompanyTypes.OneZero);
    const mainPath = path.join(bankDir, 'login-pre-done.html');
    const mainBytes = await fs.readFile(mainPath, 'utf8');
    expect(mainBytes).toBe('<html>main</html>');
    const iframe0Path = path.join(bankDir, 'login-pre-done-iframe-0.html');
    const iframe0 = await fs.readFile(iframe0Path, 'utf8');
    expect(iframe0).toBe('<iframe-0></iframe-0>');
    const iframe1Path = path.join(bankDir, 'login-pre-done-iframe-1.html');
    const iframe1 = await fs.readFile(iframe1Path, 'utf8');
    expect(iframe1).toBe('<iframe-1></iframe-1>');
    const metaPath = path.join(bankDir, 'login-pre-done.frames.json');
    const metaJson = await fs.readFile(metaPath, 'utf8');
    const meta = JSON.parse(metaJson) as {
      label: string;
      main: { url: string };
      iframes: { idx: number; url: string; name: string; htmlPath: string }[];
    };
    expect(meta.label).toBe('login-pre-done');
    expect(meta.iframes).toHaveLength(2);
    expect(meta.iframes[0].url).toBe('https://example.test/f0');
    expect(meta.iframes[0].name).toBe('frame0');
    expect(meta.iframes[1].htmlPath).toBe('login-pre-done-iframe-1.html');
  });

  it('skips iframe walk + metadata for non-login phases (narrowing)', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    process.env.DUMP_FIXTURES_DIR = rootDir;
    const pageStub = makePage('<html>main</html>', ['<iframe-0></iframe-0>']);
    const ctx = makeCtxWithPage(pageStub);
    const isOk = await dumpFixtureHtml(ctx, 'home-pre-done');
    expect(isOk).toBe(true);
    const bankDir = path.join(rootDir, CompanyTypes.OneZero);
    const mainPath = path.join(bankDir, 'home-pre-done.html');
    const mainBytes = await fs.readFile(mainPath, 'utf8');
    expect(mainBytes).toBe('<html>main</html>');
    const iframePath = path.join(bankDir, 'home-pre-done-iframe-0.html');
    const iframeRead = fs.readFile(iframePath, 'utf8');
    await expect(iframeRead).rejects.toThrow();
    const metaPath = path.join(bankDir, 'home-pre-done.frames.json');
    const metaRead = fs.readFile(metaPath, 'utf8');
    await expect(metaRead).rejects.toThrow();
  });

  it('walks iframes for pre-login phase too', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    process.env.DUMP_FIXTURES_DIR = rootDir;
    const pageStub = makePage('<html>main</html>', [
      { html: '<iframe-pl></iframe-pl>', url: 'https://example.test/pl' },
    ]);
    const ctx = makeCtxWithPage(pageStub);
    await dumpFixtureHtml(ctx, 'pre-login-action-done');
    const bankDir = path.join(rootDir, CompanyTypes.OneZero);
    const iframePath = path.join(bankDir, 'pre-login-action-done-iframe-0.html');
    const iframeBytes = await fs.readFile(iframePath, 'utf8');
    expect(iframeBytes).toBe('<iframe-pl></iframe-pl>');
    const metaPath = path.join(bankDir, 'pre-login-action-done.frames.json');
    const meta = await fs.readFile(metaPath, 'utf8');
    expect(meta).toContain('https://example.test/pl');
  });
});

describe('LoginPhaseActions writeFrameHtml direct', () => {
  it('creates the bankDir and writes main + snapshots when walkFrames=true', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    const bankDir = path.join(rootDir, 'onezero');
    const pageStub = makePage('<html>MAIN</html>', ['<a></a>']);
    const ctx = makeCtxWithPage(pageStub);
    const isOk = await writeFrameHtml({
      page: pageStub,
      bankDir,
      label: 'step1',
      input: ctx,
      walkFrames: true,
    });
    expect(isOk).toBe(true);
    const mainPath = path.join(bankDir, 'step1.html');
    const mainBytes = await fs.readFile(mainPath, 'utf8');
    expect(mainBytes).toBe('<html>MAIN</html>');
    const iframePath = path.join(bankDir, 'step1-iframe-0.html');
    const iframe0 = await fs.readFile(iframePath, 'utf8');
    expect(iframe0).toBe('<a></a>');
  });

  it('skips iframes when walkFrames=false', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    const bankDir = path.join(rootDir, 'onezero');
    const pageStub = makePage('<html>MAIN</html>', ['<a></a>']);
    const ctx = makeCtxWithPage(pageStub);
    await writeFrameHtml({
      page: pageStub,
      bankDir,
      label: 'step1',
      input: ctx,
      walkFrames: false,
    });
    const iframePath = path.join(bankDir, 'step1-iframe-0.html');
    const iframeRead = fs.readFile(iframePath, 'utf8');
    await expect(iframeRead).rejects.toThrow();
  });
});

describe('LoginPhaseActions writeIframeSnapshot atom', () => {
  it('writes one iframe file verbatim with the supplied idx', async (): Promise<void> => {
    const rootDir = await makeTempDir();
    const pageStub = makePage('<html></html>', []);
    const ctx = makeCtxWithPage(pageStub);
    const outer = { page: pageStub, bankDir: rootDir, label: 'atom', input: ctx, walkFrames: true };
    const snap = { html: '<snap>', idx: 7, url: '', name: '' };
    await writeIframeSnapshot({ fs, outer, snap });
    const targetPath = path.join(rootDir, 'atom-iframe-7.html');
    const bytes = await fs.readFile(targetPath, 'utf8');
    expect(bytes).toBe('<snap>');
    // Touch ScraperError so the import is not unused (guards against
    // accidental `throw new Error(...)` reintroduction in this file).
    void ScraperError;
  });
});
