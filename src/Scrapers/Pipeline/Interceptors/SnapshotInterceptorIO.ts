/**
 * SnapshotInterceptor I/O — filesystem helpers for persisting phase
 * snapshots. Separated from SnapshotInterceptor to keep that file under
 * the Pipeline 150-line limit.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Page } from 'playwright-core';

import type { IPipelineContext } from '../Types/PipelineContext.js';
import { captureDeepHtml } from './SnapshotDeepDom.js';
import { captureChildFrames } from './SnapshotFrameCapture.js';
import { waitForPhaseAnchor } from './SnapshotVisibilityGate.js';

/** Root directory for captured snapshots. */
const SNAPSHOT_ROOT = 'tests/snapshots';

/** Result of a snapshot write attempt — true on success, false on failure. */
type WriteResult = boolean;
/** Bank identifier — directory key under tests/snapshots. */
type CompanyId = string;
/** Absolute path to a bank's snapshot directory. */
type BankDirPath = string;
/** Whether the page.readyState === 'complete'. */
type IsDocumentReady = boolean;

/**
 * Ensure the snapshot directory exists for this bank.
 * @param companyId - Bank identifier used as subdirectory.
 * @returns Absolute path to the bank directory.
 */
function ensureBankDir(companyId: CompanyId): BankDirPath {
  const cwd = process.cwd();
  const dir = path.join(cwd, SNAPSHOT_ROOT, companyId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Attempt to write one HTML snapshot file. Returns false on I/O failure.
 * @param filePath - Absolute target path.
 * @param html - HTML payload to persist.
 * @returns True on success, false on I/O failure.
 */
function tryWrite(filePath: string, html: string): WriteResult {
  try {
    fs.writeFileSync(filePath, html, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one HTML snapshot file. Best-effort — never throws.
 * @param dir - Bank directory.
 * @param phaseName - Phase name used for the filename.
 * @param html - Page HTML to persist.
 * @returns True on success, false on I/O failure.
 */
function writeSnapshot(dir: string, phaseName: string, html: string): WriteResult {
  const filename = `${phaseName}.html`;
  const filePath = path.join(dir, filename);
  return tryWrite(filePath, html);
}

/**
 * Persist the captured HTML to disk under the previous phase's name.
 * @param companyId - Bank identifier.
 * @param previousPhase - Phase whose end state we are persisting.
 * @param html - Captured page HTML.
 * @returns True if written.
 */
function persistCapture(companyId: string, previousPhase: string, html: string): WriteResult {
  if (!html) return false;
  const dir = ensureBankDir(companyId);
  return writeSnapshot(dir, previousPhase, html);
}

/** Max time to wait for network to go idle before capturing. */
const NETWORK_IDLE_TIMEOUT_MS = 5000;
/** Max time to wait for document.readyState === 'complete'. */
const READY_STATE_TIMEOUT_MS = 10000;
/** Settle delay after network idle + ready — covers SPA fade-in animations. */
const RENDER_SETTLE_MS = 3000;

/** Fallback when waitForLoadState rejects — returns false so chain continues. */
type WaitFallback = false;

/**
 * Wait-failure fallback — swallowed so capture continues on timeout.
 * @returns Always false.
 */
function onWaitFailure(): WaitFallback {
  return false;
}

/**
 * Browser-context predicate — true once the document is fully loaded.
 * Runs inside Playwright's page.waitForFunction evaluation.
 * @returns True when document.readyState is 'complete'.
 */
function isDocumentReady(): IsDocumentReady {
  return document.readyState === 'complete';
}

/**
 * Wait for the page to reach a stable render state before we snapshot it.
 * Three gates:
 *   1. networkidle (XHR quiescence)
 *   2. document.readyState === 'complete' (all subresources loaded)
 *   3. 5 s settle (fade-in animations, post-render DOM attachment)
 * All timeouts are swallowed — worst case we snapshot a slightly-less-baked
 * DOM rather than stalling the whole recorder.
 * @param page - Playwright Page to stabilise.
 * @returns True once the wait chain completes.
 */
async function waitForRender(page: Page): Promise<boolean> {
  const idleOpts = { timeout: NETWORK_IDLE_TIMEOUT_MS };
  await page.waitForLoadState('networkidle', idleOpts).catch(onWaitFailure);
  const readyOpts = { timeout: READY_STATE_TIMEOUT_MS };
  await page.waitForFunction(isDocumentReady, null, readyOpts).catch(onWaitFailure);
  await page.waitForTimeout(RENDER_SETTLE_MS).catch(onWaitFailure);
  return true;
}

/**
 * Capture the current page HTML and save it as the previous phase's snapshot.
 * Waits for networkidle + a settle delay so SPA frameworks finish rendering
 * before page.content() is called — otherwise early-phase snapshots capture
 * only the JS bootstrap shell, not the rendered DOM.
 * @param ctx - Current pipeline context.
 * @param previousPhase - Name of the phase that just finished.
 * @returns True if snapshot was written, false otherwise.
 */
async function captureSnapshot(ctx: IPipelineContext, previousPhase: string): Promise<WriteResult> {
  if (!ctx.browser.has) return false;
  const { page } = ctx.browser.value;
  await waitForRender(page);
  const isAnchorVisible = await waitForPhaseAnchor(page, previousPhase);
  if (!isAnchorVisible) return false;
  const html = await captureDeepHtml(page);
  const didWriteMain = persistCapture(ctx.companyId, previousPhase, html);
  await captureChildFrames(page, ctx.companyId);
  return didWriteMain;
}

export default captureSnapshot;
export { captureSnapshot };
