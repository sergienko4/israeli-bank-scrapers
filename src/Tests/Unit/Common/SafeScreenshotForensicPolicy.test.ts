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

describe('forensic screenshot policy — pr.yml <-> SafeScreenshot drift pin', () => {
  const prYml = readFileSync(PR_YML_PATH, 'utf8');

  it('no public upload-artifact step globs screenshots (PII pixels stay private)', () => {
    expect(prYml).not.toContain('screenshots/*.png');
  });

  it('wires the FORENSIC_TRACE opt-in into the e2e-real jobs', () => {
    expect(prYml).toContain('FORENSIC_TRACE');
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
