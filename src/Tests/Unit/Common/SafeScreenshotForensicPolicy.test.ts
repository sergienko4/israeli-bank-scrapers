/**
 * pr.yml <-> SafeScreenshot forensic-model drift pin.
 *
 * Background: SafeScreenshot.ts no longer makes any CI/PII routing decision.
 * Forensic capture (screenshots + network dumps + pipeline.log) is gated
 * UPSTREAM by the opt-in `FORENSIC_TRACE=true` flag at
 * `TraceConfig.getRunFolder()` — off by default, so no run folder (and thus no
 * screenshot) is ever produced unless a maintainer explicitly opts in.
 *
 * Because `safeScreenshot` now writes the supplied path verbatim (it does NOT
 * divert post-auth pixels into a sibling private/ dir any more), the ONLY thing
 * keeping rendered post-auth pixels out of the *public* CI artifact is the
 * workflow itself: `.github/workflows/pr.yml` must (a) exclude the
 * `screenshots/*.png` glob from every public upload-artifact step and (b) wire
 * the `FORENSIC_TRACE` opt-in so the access-controlled diagnostics store is the
 * sole sink for screenshots. This pin re-binds the two surfaces so a tweak to
 * either trips the test and forces both to move together.
 *
 * See `src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts` (capture) and
 * `src/Scrapers/Pipeline/Types/TraceConfig.ts` (FORENSIC_TRACE gate).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { safeScreenshot } from '../../../Common/SafeScreenshot.js';

const REPO_ROOT = process.cwd();
const PR_YML_PATH = resolve(REPO_ROOT, '.github', 'workflows', 'pr.yml');
const COMMENT_LINE_RE = /^\s*#/;
const PNG_GLOB_RE = /\*\.png/i;
const FORENSIC_TRACE_WIRING = 'FORENSIC_TRACE: ${{ vars.FORENSIC_TRACE }}';
const E2E_DIAG_NAME = 'name: e2e-real-${{ matrix.bank }}-diag-';
const PUBLIC_PATH_START = 'path: |';
const RETENTION_DAYS_KEY = 'retention-days:';
const ALLOWED_PUBLIC_E2E_PATHS = [
  '/tmp/runs/pipeline/**/pipeline.log',
  '/tmp/runs/pipeline/**/network/*.json',
] as const;

/**
 * Creates a mock Playwright Page exposing only `screenshot` as a jest mock.
 * @returns An object exposing the screenshot mock and the Page-typed view.
 */
function makeMockPage(): { page: Page; screenshotMock: jest.Mock } {
  const emptyBuffer = Buffer.alloc(0);
  const screenshotMock = jest.fn().mockResolvedValue(emptyBuffer);
  const page = { screenshot: screenshotMock } as unknown as Page;
  return { page, screenshotMock };
}

/**
 * Identify executable workflow lines, excluding comments from drift pins.
 * @param line - Raw workflow line.
 * @returns True when the line is not a comment.
 */
function isWorkflowCodeLine(line: string): boolean {
  return !COMMENT_LINE_RE.test(line);
}

/**
 * Remove comment-only workflow lines so assertions bind to real wiring.
 * @param input - Raw workflow YAML.
 * @returns Workflow YAML without comment-only lines.
 */
function stripCommentLines(input: string): string {
  const lines = input.split('\n');
  const codeLines = lines.filter(isWorkflowCodeLine);
  return codeLines.join('\n');
}

/**
 * Test whether a workflow line names an e2e diagnostics artifact.
 * @param line - Workflow line.
 * @returns True when the line starts an e2e diagnostics upload config.
 */
function isE2eDiagNameLine(line: string): boolean {
  return line.includes(E2E_DIAG_NAME);
}

/**
 * Test whether a workflow line starts a multiline artifact path block.
 * @param line - Workflow line.
 * @returns True when the line is the upload `path: |` key.
 */
function isPathStartLine(line: string): boolean {
  return line.trim() === PUBLIC_PATH_START;
}

/**
 * Test whether a workflow line closes the artifact path block.
 * @param line - Workflow line.
 * @returns True when the line starts the retention-days key.
 */
function isRetentionDaysLine(line: string): boolean {
  return line.trim().startsWith(RETENTION_DAYS_KEY);
}

/**
 * Locate the path block that follows an e2e diagnostics artifact name.
 * @param lines - Workflow lines.
 * @param start - Index of the artifact name line.
 * @returns Index of the following path key, or -1 when absent.
 */
function findPathStartAfter(lines: readonly string[], start: number): number {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isPathStartLine(lines[index])) return index;
  }
  return -1;
}

/**
 * Read a multiline path block until the retention-days key.
 * @param lines - Workflow lines.
 * @param pathStart - Index of the path key line.
 * @returns Multiline upload path block.
 */
function readPathBlock(lines: readonly string[], pathStart: number): string {
  const blockLines: string[] = [];
  for (let index = pathStart + 1; index < lines.length; index += 1) {
    if (isRetentionDaysLine(lines[index])) break;
    blockLines.push(lines[index]);
  }
  return blockLines.join('\n');
}

/**
 * Trim a workflow path line for exact allowlist comparison.
 * @param line - Raw path-block line.
 * @returns Trimmed path line.
 */
function trimPathLine(line: string): string {
  return line.trim();
}

/**
 * Test whether a normalized path line carries content.
 * @param line - Trimmed path line.
 * @returns True when the line is non-empty.
 */
function isNonEmptyLine(line: string): boolean {
  return line.length > 0;
}

/**
 * Normalize a workflow path block into comparable path entries.
 * @param block - Multiline upload path block.
 * @returns Non-empty trimmed path lines.
 */
function toPathLines(block: string): readonly string[] {
  const lines = block.split('\n');
  return lines.map(trimPathLine).filter(isNonEmptyLine);
}

/**
 * Collect public e2e diagnostics upload path blocks from the workflow.
 * @param input - Raw workflow YAML.
 * @returns Multiline path blocks for public e2e diagnostics artifacts.
 */
function collectPublicE2ePathBlocks(input: string): string[] {
  const lines = input.split('\n');
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!isE2eDiagNameLine(lines[index])) continue;
    const pathStart = findPathStartAfter(lines, index);
    if (pathStart < 0) continue;
    const pathBlock = readPathBlock(lines, pathStart);
    blocks.push(pathBlock);
  }
  return blocks;
}

describe('forensic screenshot policy — pr.yml <-> SafeScreenshot drift pin', () => {
  const prYml = readFileSync(PR_YML_PATH, 'utf8');

  it('public e2e diagnostics upload only pipeline.log and redacted network JSON', () => {
    const pathBlocks = collectPublicE2ePathBlocks(prYml);
    expect(pathBlocks.length).toBeGreaterThan(0);
    for (const block of pathBlocks) {
      const pathLines = toPathLines(block);
      expect(pathLines).toEqual(ALLOWED_PUBLIC_E2E_PATHS);
    }
  });

  it('no public e2e diagnostics upload path can glob screenshots', () => {
    const publicPaths = collectPublicE2ePathBlocks(prYml).join('\n');
    expect(publicPaths).not.toMatch(PNG_GLOB_RE);
  });

  it('wires the FORENSIC_TRACE opt-in into the e2e-real jobs', () => {
    const workflowCode = stripCommentLines(prYml);
    expect(workflowCode).toContain(FORENSIC_TRACE_WIRING);
  });

  it('documents that screenshots never reach the public artifact', () => {
    expect(prYml).toContain('Screenshots never reach the public artifact');
  });

  it('safeScreenshot writes the supplied path verbatim — no private/ diversion', async () => {
    const { page, screenshotMock } = makeMockPage();
    const path = '/tmp/runs/pipeline/isracard/screenshots/isracard-dashboard-post-done.png';

    const didCapture = await safeScreenshot(page, { path, fullPage: false });

    expect(didCapture).toBe(true);
    const [firstCall] = screenshotMock.mock.calls[0] as [{ path: string }];
    expect(firstCall.path).toBe(path);
    expect(firstCall.path).not.toContain('/private/');
  });
});
