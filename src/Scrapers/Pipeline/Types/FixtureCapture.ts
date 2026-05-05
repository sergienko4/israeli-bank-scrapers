/**
 * Fixture HTML capture — used by BasePhase auto-bookend so the same trace
 * mode that takes pre/post screenshots ALSO writes main-frame + iframe HTML
 * to <DUMP_FIXTURES_DIR>/<bank>/<label>.html when the env var is set.
 *
 * Decoupled from any specific phase: BasePhase calls dumpFixtureHtml at the
 * pre/post bookend, so every phase emits the same artifact set without
 * per-phase helpers. No-op when DUMP_FIXTURES_DIR is unset or the phase has
 * no browser attached.
 *
 * Frame-walking is narrowed to the phases that prove the login normalization
 * (`pre-login` and `login`). Other phases dump the parent document only.
 * Walked phases also emit a sibling `<label>.frames.json` metadata file so a
 * local validator can map iframe-N back to its live URL/name and decide which
 * frame held the password input at that moment.
 */

import type { Frame, Page } from 'playwright-core';

import { redactHtml, redactJsonBody } from './PiiRedactor.js';
import type { IPipelineContext } from './PipelineContext.js';

/** Stage-output suffixes appended by BasePhase.takePhaseScreenshot. */
const STAGE_SUFFIXES: readonly string[] = [
  '-pre-done',
  '-action-done',
  '-post-done',
  '-final-done',
];

/** Phases whose iframes are dumped + metadata-tracked (login normalization). */
const FRAME_WALK_PHASES: readonly string[] = ['pre-login', 'login'];

/**
 * Strip the stage suffix from a label to recover the phase name.
 * @param label - Full label like "login-pre-done".
 * @returns Phase name like "login".
 */
function extractPhaseFromLabel(label: string): string {
  const found = STAGE_SUFFIXES.find((s): boolean => label.endsWith(s));
  if (found === undefined) return label;
  return label.slice(0, -found.length);
}

/**
 * Decide whether to walk frames and write metadata for this label.
 * Only `pre-login` and `login` phases qualify (login-normalization scope).
 * @param label - Full label like "login-pre-done".
 * @returns True iff frames should be walked.
 */
function shouldWalkFrames(label: string): boolean {
  const phase = extractPhaseFromLabel(label);
  return FRAME_WALK_PHASES.includes(phase);
}

/** Bundled args for writing frame fixtures (3-param ceiling). */
export interface IWriteFrameArgs {
  readonly page: Page;
  readonly bankDir: string;
  readonly label: string;
  readonly input: IPipelineContext;
  readonly walkFrames: boolean;
}

/** One iframe html snapshot ready to write — with frame URL/name metadata. */
interface IIframeSnapshot {
  readonly html: string;
  readonly url: string;
  readonly name: string;
}

/** An iframe snapshot paired with its stable index. */
interface IIndexedSnapshot {
  readonly html: string;
  readonly url: string;
  readonly name: string;
  readonly idx: number;
}

import type * as FsPromisesNs from 'node:fs/promises';

type FsPromisesModule = typeof FsPromisesNs;

/** Bundled args for writing one iframe file (3-param ceiling). */
export interface IWriteIframeArgs {
  readonly fs: FsPromisesModule;
  readonly outer: IWriteFrameArgs;
  readonly snap: IIndexedSnapshot;
}

/**
 * Read one frame's HTML content, swallowing navigation/detached errors.
 * @param frame - Target frame.
 * @returns HTML string (empty on error).
 */
async function readFrameContent(frame: Frame): Promise<string> {
  return frame.content().catch((): string => '');
}

/** Frame URL string (or empty when the frame is detached / stub). */
/** Frame `name` attribute (or empty when the frame is anonymous / stub). */

/**
 * Defensive lookup of `frame.url()` — Playwright frames have it; some test
 * stubs don't. Returns empty string when the method is missing or throws.
 * @param frame - Target frame.
 * @returns Frame URL or empty string.
 */
function readFrameUrl(frame: Frame): string {
  const fn = (frame as { url?: () => string }).url;
  if (typeof fn !== 'function') return '';
  try {
    return fn.call(frame);
  } catch {
    return '';
  }
}

/**
 * Defensive lookup of `frame.name()` — same rationale as readFrameUrl.
 * @param frame - Target frame.
 * @returns Frame name attribute or empty string.
 */
function readFrameName(frame: Frame): string {
  const fn = (frame as { name?: () => string }).name;
  if (typeof fn !== 'function') return '';
  try {
    return fn.call(frame);
  } catch {
    return '';
  }
}

/**
 * Async pluck of each child frame's HTML in parallel. Keeps frame order
 * so iframe indices stay stable. Exported so focused unit tests can
 * exercise the iframe-walk + filter logic without going through the
 * full writeFrameHtml chain.
 * @param page - Playwright page.
 * @returns Non-empty iframe snapshots.
 */
export async function collectIframeSnapshots(page: Page): Promise<readonly IIframeSnapshot[]> {
  const mainFrame = page.mainFrame();
  const children = page.frames().filter((f): boolean => f !== mainFrame);
  const readPromises = children.map(readFrameContent);
  const htmls = await Promise.all(readPromises);
  const snaps = children.map(
    (f, i): IIframeSnapshot => ({
      html: htmls[i],
      url: readFrameUrl(f),
      name: readFrameName(f),
    }),
  );
  return snaps.filter((s): boolean => s.html.length > 0);
}

/**
 * Build the write-promise for a single iframe snapshot.
 * @param args - Bundled fs + outer + snapshot.
 * @returns Write promise.
 */
export function writeIframeSnapshot(args: IWriteIframeArgs): Promise<void> {
  const idxStr = String(args.snap.idx);
  const filePath = `${args.outer.bankDir}/${args.outer.label}-iframe-${idxStr}.html`;
  const safeHtml = redactHtml(args.snap.html);
  return args.fs.writeFile(filePath, safeHtml, 'utf8');
}

/** Per-iframe metadata row written to <label>.frames.json. */
interface IIframeMetaRow {
  readonly idx: number;
  readonly url: string;
  readonly name: string;
  readonly htmlPath: string;
}

/** Frame-set metadata for one phase-stage label. */
interface IFrameMetaFile {
  readonly label: string;
  readonly main: { readonly url: string; readonly htmlPath: string };
  readonly iframes: readonly IIframeMetaRow[];
}

/**
 * Write a sibling <label>.frames.json mapping iframe-N file → live URL/name.
 * Lets a local validator pick the iframe that held the password input.
 * @param fs - node:fs/promises module.
 * @param args - Outer write args (page + bankDir + label).
 * @param indexed - Indexed iframe snapshots (in stable order).
 * @returns Write promise.
 */
async function writeFrameMetadata(
  fs: FsPromisesModule,
  args: IWriteFrameArgs,
  indexed: readonly IIndexedSnapshot[],
): Promise<void> {
  const mainUrl = args.page.url();
  const meta: IFrameMetaFile = {
    label: args.label,
    main: { url: mainUrl, htmlPath: `${args.label}.html` },
    iframes: indexed.map(
      (s): IIframeMetaRow => ({
        idx: s.idx,
        url: s.url,
        name: s.name,
        htmlPath: `${args.label}-iframe-${String(s.idx)}.html`,
      }),
    ),
  };
  const metaPath = `${args.bankDir}/${args.label}.frames.json`;
  const json = JSON.stringify(meta);
  const safeJson = redactJsonBody(json);
  await fs.writeFile(metaPath, safeJson, 'utf8');
}

/**
 * Walk iframes (HTML + metadata) when args.walkFrames is true. No-op when
 * the label's phase is outside FRAME_WALK_PHASES (narrowing).
 * @param fs - node:fs/promises module.
 * @param args - Outer write args.
 * @returns Resolves when all writes complete.
 */
async function maybeWalkFrames(fs: FsPromisesModule, args: IWriteFrameArgs): Promise<number> {
  if (!args.walkFrames) return 0;
  const snapshots = await collectIframeSnapshots(args.page);
  const indexed = snapshots.map(
    (s, idx): IIndexedSnapshot => ({
      html: s.html,
      url: s.url,
      name: s.name,
      idx,
    }),
  );
  const writePromises = indexed.map(
    (s): Promise<void> => writeIframeSnapshot({ fs, outer: args, snap: s }),
  );
  await Promise.all(writePromises);
  await writeFrameMetadata(fs, args, indexed);
  return indexed.length;
}

/**
 * Write page.content() to <bankDir>/<label>.html. When walkFrames is true
 * also write each iframe to <bankDir>/<label>-iframe-<idx>.html plus a
 * <bankDir>/<label>.frames.json metadata sidecar mapping idx → URL/name.
 * @param args - Bundled page + bankDir + label + context + walkFrames.
 * @returns True after write.
 */
export async function writeFrameHtml(args: IWriteFrameArgs): Promise<true> {
  const fs = await import('node:fs/promises');
  await fs.mkdir(args.bankDir, { recursive: true });
  const mainHtml = await args.page.content();
  const safeMainHtml = redactHtml(mainHtml);
  await fs.writeFile(`${args.bankDir}/${args.label}.html`, safeMainHtml, 'utf8');
  args.input.logger.debug({ message: `fixture: ${args.bankDir}/${args.label}.html` });
  const iframesWritten = await maybeWalkFrames(fs, args);
  args.input.logger.debug({ message: `iframes: ${String(iframesWritten)}` });
  return true;
}

/**
 * When DUMP_FIXTURES_DIR env var is set, save page + (login/pre-login only)
 * iframe HTML so a local validator can prove discoverFormAnchor against the
 * exact bytes the bank served at that phase. No-op otherwise. Called from
 * BasePhase auto-bookend (4 stage outputs per phase) so every phase emits
 * the same artifact set without per-phase helpers.
 * @param input - Pipeline context with browser.
 * @param label - Same label used by the screenshot path.
 * @returns True when bytes were actually written, false on no-op skip
 * (DUMP_FIXTURES_DIR unset/empty, or no browser attached). Callers MUST
 * treat false as "not an error" — it is the documented gate.
 */
export async function dumpFixtureHtml(input: IPipelineContext, label: string): Promise<boolean> {
  const rootEnv = process.env.DUMP_FIXTURES_DIR;
  if (rootEnv === undefined || rootEnv.length === 0) return false;
  if (!input.browser.has) return false;
  const page = input.browser.value.page;
  const bank = input.companyId;
  const bankDir = `${rootEnv}/${bank}`.replaceAll('\\', '/');
  const shouldWalk = shouldWalkFrames(label);
  const didWrite = await writeFrameHtml({
    page,
    bankDir,
    label,
    input,
    walkFrames: shouldWalk,
  }).catch((): false => false);
  return didWrite;
}

export { extractPhaseFromLabel, FRAME_WALK_PHASES, shouldWalkFrames };
