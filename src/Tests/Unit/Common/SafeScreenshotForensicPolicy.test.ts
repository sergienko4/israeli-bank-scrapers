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
 * keeping rendered post-auth pixels — and every other diagnostic — out of any
 * *public* CI artifact is the workflow itself: `.github/workflows/pr.yml` must
 * upload e2e-real failure diagnostics to NO public GitHub artifact and route
 * them solely to the access-controlled private store
 * (`upload-private-diagnostics.sh`). This pin re-binds the two surfaces so a
 * tweak to either trips the test and forces both to move together.
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
const FORENSIC_TRACE_WIRING = "FORENSIC_TRACE: ${{ vars.FORENSIC_TRACE || 'true' }}";
// Block ANY public upload of forensic pixels/dumps, not just one artifact name:
// a renamed step that still publishes screenshots or /tmp/runs/pipeline must trip
// this — including block/list `path:` forms where the location is on a later line.
const FORBIDDEN_PUBLIC_DIAG_UPLOAD =
  /uses:\s*actions\/upload-artifact@[\s\S]{0,250}?\bpath:[\s\S]{0,250}?(?:screenshots|\/tmp\/runs\/pipeline)/i;
const PRIVATE_STORE_STEP = 'Upload full diagnostics to private store';
const PRIVATE_STORE_SCRIPT = 'bash .github/scripts/ci/upload-private-diagnostics.sh';

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

describe('forensic screenshot policy — pr.yml <-> SafeScreenshot drift pin', () => {
  const prYml = readFileSync(PR_YML_PATH, 'utf8');

  it('uploads no public e2e diagnostics artifact — private store is the sole sink', () => {
    const workflowCode = stripCommentLines(prYml);
    expect(workflowCode).not.toMatch(FORBIDDEN_PUBLIC_DIAG_UPLOAD);
  });

  it('flags a block/list-form public upload of pipeline diagnostics (multiline)', () => {
    // R3-20 firing guard: the matcher must catch block/list `path:` forms where
    // the sensitive location sits on a later line. RED on the prior `[^\n]*`
    // single-line matcher; GREEN on the broadened `[\s\S]` scan.
    const blockFormUpload = [
      'uses: actions/upload-artifact@v4',
      'with:',
      '  name: e2e-diag',
      '  path: |',
      '    /tmp/runs/pipeline',
    ].join('\n');
    expect(blockFormUpload).toMatch(FORBIDDEN_PUBLIC_DIAG_UPLOAD);
  });

  it('routes e2e-real failure diagnostics to the private store', () => {
    const workflowCode = stripCommentLines(prYml);
    expect(workflowCode).toContain(PRIVATE_STORE_STEP);
    expect(workflowCode).toContain(PRIVATE_STORE_SCRIPT);
  });

  it('wires the FORENSIC_TRACE default (|| true) into the e2e-real jobs', () => {
    const workflowCode = stripCommentLines(prYml);
    expect(workflowCode).toContain(FORENSIC_TRACE_WIRING);
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
