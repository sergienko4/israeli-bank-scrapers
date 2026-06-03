/**
 * Per-iframe snapshot capture + URL-key helpers.
 *
 * page.content() only serialises the <iframe> element tag, not its inner
 * document tree. Banks like Beinleumi render the OTP modal inside a
 * cross-origin iframe (MatafLoginServlet), so the PIN cluster lives in a
 * separate document Playwright stores as a child Frame.
 *
 * To let downstream replay tools serve the full DOM we capture each child
 * frame's content() separately and store it under a filename derived from
 * the frame URL. The replay layer hashes the request URL the same way and
 * serves the matching file when the browser asks the iframe src.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Frame, Page } from 'playwright-core';

import type { Brand } from '../Types/Brand.js';
import { redactHtml } from '../Types/PiiRedactor.js';

/** URL-derived snapshot filename. */
type FrameFilename = Brand<string, 'FrameFilename'>;
/** Absolute path to a captured frame file. */
type FrameFilePath = Brand<string, 'FrameFilePath'>;
/** Absolute path to the bank's frames directory. */
type FramesDirPath = Brand<string, 'FramesDirPath'>;
/** Snapshot HTML body read from a Playwright Frame. */
type FrameHtmlSnapshot = Brand<string, 'FrameHtmlSnapshot'>;
/** Frame-write success/failure outcome. */
type DidWriteFrame = Brand<boolean, 'DidWriteFrame'>;
/** Main-vs-child frame predicate. */
type IsChildFrame = Brand<boolean, 'IsChildFrame'>;

/** Root directory for captured snapshots — mirrors SnapshotInterceptorIO. */
const SNAPSHOT_ROOT = 'tests/snapshots';
/** Subdirectory for per-frame files — one per bank. */
const FRAMES_DIR = 'frames';
/** Hash length for the URL-derived filename. */
const HASH_LEN = 12;

/**
 * Short, filesystem-safe filename for a given frame URL. Hashes a stable
 * origin+pathname key (drops query string) so 3rd-party telemetry URLs
 * with per-session params (msid, session_id, ts) resolve to the same
 * captured snapshot. Same function is used by both recorder (write side)
 * and mock (read side) so the hashes match.
 * @param url - Frame URL.
 * @returns Filename like 'a1b2c3d4e5f6.html'.
 */
export function frameFilenameForUrl(url: string): FrameFilename {
  const parsed = URL.canParse(url) && new URL(url);
  const key = (parsed && `${parsed.origin}${parsed.pathname}`) || url;
  // SHA-256 (not for security — used only as a stable filename slug).
  // Switched from sha1 to satisfy `typescript:S4790` weak-hash hotspot.
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, HASH_LEN);
  return `${hash}.html` as FrameFilename;
}

/**
 * Absolute path to the per-frame file for a given bank + URL.
 * @param companyId - Bank identifier (directory).
 * @param url - Frame URL.
 * @returns Absolute path.
 */
export function frameFilePath(companyId: string, url: string): FrameFilePath {
  const cwd = process.cwd();
  const filename = frameFilenameForUrl(url);
  return path.join(cwd, SNAPSHOT_ROOT, companyId, FRAMES_DIR, filename) as FrameFilePath;
}

/**
 * Ensure the per-bank frames directory exists.
 * @param companyId - Bank identifier.
 * @returns Absolute path to the frames directory.
 */
function ensureFramesDir(companyId: string): FramesDirPath {
  const cwd = process.cwd();
  const dir = path.join(cwd, SNAPSHOT_ROOT, companyId, FRAMES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir as FramesDirPath;
}

/**
 * Read one frame's content and write it to disk. Best-effort — detached
 * frames, cross-origin evaluation failures, and I/O errors are all swallowed.
 * @param frame - Playwright Frame to capture.
 * @param companyId - Bank identifier.
 * @returns True if a file was written.
 */
/** Wait for each frame to hydrate before snapshotting. */
const FRAME_IDLE_TIMEOUT_MS = 3000;
/** Settle delay so iframe JS attaches DOM after network goes idle. */
const FRAME_SETTLE_MS = 1500;

/**
 * Wait for a frame to reach networkidle + settle. Best-effort — timeouts
 * are swallowed so a slow third-party iframe doesn't hold up the capture.
 * @param frame - Frame to stabilise.
 * @returns Always true (side-effect only).
 */
async function waitForFrameRender(frame: Frame): Promise<true> {
  const opts = { timeout: FRAME_IDLE_TIMEOUT_MS };
  await frame.waitForLoadState('networkidle', opts).catch((): false => false);
  await frame.waitForTimeout(FRAME_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Best-effort write of HTML to an absolute path.
 * @param file - Absolute target path.
 * @param html - Content to persist.
 * @returns True on success, false on I/O failure.
 */
function tryWriteFrame(file: string, html: string): DidWriteFrame {
  try {
    const safeHtml = redactHtml(html);
    fs.writeFileSync(file, safeHtml, 'utf8');
    return true as DidWriteFrame;
  } catch {
    return false as DidWriteFrame;
  }
}

/**
 * Capture one frame's hydrated content.
 * @param frame - Playwright Frame to read.
 * @param companyId - Bank identifier.
 * @returns True if a file was written, false on skip/failure.
 */
async function captureOneFrame(frame: Frame, companyId: string): Promise<boolean> {
  const url = frame.url();
  if (!url || url === 'about:blank') return false;
  await waitForFrameRender(frame);
  const html = await frame.content().catch((): FrameHtmlSnapshot => '' as FrameHtmlSnapshot);
  if (!html) return false;
  const dir = ensureFramesDir(companyId);
  const filename = frameFilenameForUrl(url);
  const file = path.join(dir, filename);
  return tryWriteFrame(file, html);
}

/**
 * Capture every child frame of the page (skip main frame — main goes via
 * the phase-level .html file). Called by SnapshotInterceptor after the
 * main page.content() is persisted.
 * @param page - Playwright Page.
 * @param companyId - Bank identifier.
 * @returns Count of frames persisted.
 */
export async function captureChildFrames(page: Page, companyId: string): Promise<number> {
  const main = page.mainFrame();
  const children = page.frames().filter((f): IsChildFrame => (f !== main) as IsChildFrame);
  /**
   * Bind companyId so Promise.all receives a named function.
   * @param f - Frame to capture.
   * @returns Write outcome.
   */
  const captureFn = (f: Frame): Promise<boolean> => captureOneFrame(f, companyId);
  const jobs = children.map(captureFn);
  const writes = await Promise.all(jobs);
  return writes.filter(Boolean).length;
}
