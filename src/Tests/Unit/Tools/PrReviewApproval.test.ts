/**
 * Unit tests for the pure review-event decision. The tests pin the existing
 * branch policy boundaries: review completeness, permissions, PR state and the
 * one-new-commit rule after a request-changes review.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  canApprove,
  decideReview,
  hasBlockingFindings,
  isReviewComplete,
} from '../../../../.github/scripts/pr-review/approval.mjs';
import {
  decideFromEnv,
  hasBlockingReview,
} from '../../../../.github/scripts/pr-review/decide-event.mjs';
import { validateReview } from '../../../../.github/scripts/pr-review/post-review.mjs';
import { responseTo, urlOf } from './PrReviewAgentTestUtils.js';

const CONFIG = {
  blockingSeverities: ['critical', 'important'],
  maxFiles: 300,
  approval: { enabled: true, allowAuthor: true },
};

const CLEAN_METADATA = {
  headSha: 'head-sha',
  diffTruncated: false,
  credentialContent: false,
  skippedFiles: [],
  sensitiveFiles: [],
  changedFiles: 1,
  files: [{ path: 'src/a.ts', dataFile: 'file-000.txt' }],
};

const CLEAN_PR = {
  state: 'open',
  draft: false,
  isFork: false,
  authorLogin: 'author',
  headSha: 'head-sha',
};

/**
 * Build decision arguments with explicit overrides.
 * @param overrides - Fields to replace.
 * @returns Decision arguments.
 */
function args(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command: 'approve',
    findings: [],
    metadata: CLEAN_METADATA,
    pullRequest: CLEAN_PR,
    actor: 'maintainer',
    actorPermission: 'write',
    headSha: 'head-sha',
    config: CONFIG,
    reviewComplete: true,
    ...overrides,
  };
}

describe('review event decision', () => {
  it('returns COMMENT for a clean plain review', () => {
    const options = args({ command: 'review' });
    const decision = decideReview(options);
    expect(decision).toEqual({
      event: 'COMMENT',
      reason: 'clean review',
      dismissBlocking: true,
    });
  });

  it('does not dismiss a block when a plain review is incomplete', () => {
    const options = args({ command: 'review', reviewComplete: false });
    const decision = decideReview(options);
    expect(decision.dismissBlocking).toBe(false);
  });

  it('does not dismiss a block on the same head', () => {
    const options = args({
      command: 'review',
      previousReview: { blocking: true, headSha: 'head-sha' },
    });
    const decision = decideReview(options);
    expect(decision.dismissBlocking).toBe(false);
  });

  it('returns REQUEST_CHANGES for a blocking plain review', () => {
    const options = args({
      command: 'review',
      findings: [{ severity: 'important' }],
    });
    const decision = decideReview(options);
    expect(decision.event).toBe('REQUEST_CHANGES');
  });

  it('returns APPROVE for a clean approval request', () => {
    const options = args();
    const decision = decideReview(options);
    expect(decision).toEqual({
      event: 'APPROVE',
      reason: 'clean review',
      dismissBlocking: false,
    });
  });

  it('returns REQUEST_CHANGES when approval has blocking findings', () => {
    const options = args({ findings: [{ severity: 'critical' }] });
    const decision = decideReview(options);
    expect(decision).toEqual({
      event: 'REQUEST_CHANGES',
      reason: 'blocking findings',
      dismissBlocking: false,
    });
  });

  it('suggestions alone do not block approval', () => {
    const options = args({ findings: [{ severity: 'suggestion' }] });
    const decision = decideReview(options);
    expect(decision.event).toBe('APPROVE');
  });
});

describe('approval permission and PR state', () => {
  it.each(['read', 'triage', 'none'])('refuses approval for %s permission', permission => {
    const options = args({ actorPermission: permission });
    const decision = decideReview(options);
    expect(decision.event).toBe('COMMENT');
    expect(decision.reason).toBe('actor cannot approve');
  });

  it('accepts write, maintain and admin permissions', () => {
    for (const permission of ['write', 'maintain', 'admin']) {
      const canApprovePermission = canApprove(permission);
      expect(canApprovePermission).toBe(true);
    }
  });

  it('allows the author by default', () => {
    const options = args({ actor: 'author' });
    const decision = decideReview(options);
    expect(decision.event).toBe('APPROVE');
  });

  it('refuses the author when allowAuthor is false', () => {
    const options = args({
      actor: 'author',
      config: { ...CONFIG, approval: { ...CONFIG.approval, allowAuthor: false } },
    });
    const decision = decideReview(options);
    expect(decision.event).toBe('COMMENT');
    expect(decision.reason).toBe('the author cannot approve');
  });

  it('refuses a draft, closed, fork or moved-head PR', () => {
    for (const pullRequest of [
      { ...CLEAN_PR, draft: true },
      { ...CLEAN_PR, state: 'closed' },
      { ...CLEAN_PR, isFork: true },
      { ...CLEAN_PR, headSha: 'other-sha' },
    ]) {
      const options = args({ pullRequest });
      const decision = decideReview(options);
      expect(decision.event).toBe('COMMENT');
    }
  });

  it('refuses approval when the metadata belongs to another head', () => {
    const options = args({ metadata: { ...CLEAN_METADATA, headSha: 'older-sha' } });
    const decision = decideReview(options);
    expect(decision.event).toBe('COMMENT');
    expect(decision.reason).toBe('the review metadata is for another head');
  });

  it('refuses a blocking review from a read-only actor', () => {
    const options = args({
      command: 'review',
      actorPermission: 'read',
      findings: [{ severity: 'critical', path: 'src/a.ts', line: 1, title: 't', body: 'b' }],
    });
    const decision = decideReview(options);
    expect(decision.event).toBe('COMMENT');
    expect(decision.reason).toBe('actor cannot request changes');
  });

  it('refuses approval when approval is disabled', () => {
    const options = args({
      config: { ...CONFIG, approval: { ...CONFIG.approval, enabled: false } },
    });
    const decision = decideReview(options);
    expect(decision.event).toBe('COMMENT');
    expect(decision.reason).toBe('approval is disabled');
  });
});

describe('review completeness', () => {
  it.each([
    ['truncated diff', { ...CLEAN_METADATA, diffTruncated: true }],
    ['credential content', { ...CLEAN_METADATA, credentialContent: true }],
    ['skipped file', { ...CLEAN_METADATA, skippedFiles: ['src/a.ts'] }],
    ['sensitive file', { ...CLEAN_METADATA, sensitiveFiles: ['.env'] }],
    ['file list mismatch', { ...CLEAN_METADATA, files: [] }],
    [
      'file cap',
      {
        ...CLEAN_METADATA,
        changedFiles: 301,
        files: Array.from({ length: 301 }, (_, index) => ({
          path: `src/file-${String(index)}.ts`,
          dataFile: `file-${String(index).padStart(3, '0')}.txt`,
        })),
      },
    ],
    ['missing metadata', {}],
    [
      'missing coverage arrays',
      { diffTruncated: false, credentialContent: false, changedFiles: 1 },
    ],
    ['fractional changed files', { ...CLEAN_METADATA, changedFiles: 1.5 }],
    ['negative changed files', { ...CLEAN_METADATA, changedFiles: -1 }],
  ])('refuses approval for %s', (_name, metadata) => {
    const options = args({ metadata });
    const decision = decideReview(options);
    expect(decision.event).toBe('COMMENT');
    expect(decision.reason).toBe('the review is incomplete');
  });

  it('accepts a complete review at the file cap', () => {
    const files = Array.from({ length: 300 }, (_, index) => ({
      path: `src/file-${String(index)}.ts`,
      dataFile: `file-${String(index).padStart(3, '0')}.txt`,
    }));
    const metadata = { ...CLEAN_METADATA, changedFiles: 300, files };
    const isComplete = isReviewComplete(metadata, CONFIG);
    const options = args({ metadata });
    const decision = decideReview(options);
    expect(isComplete).toBe(true);
    expect(decision.event).toBe('APPROVE');
  });

  it('refuses approval when the review JSON says it is incomplete', () => {
    const options = args({ reviewComplete: false });
    const decision = decideReview(options);
    expect(decision.event).toBe('COMMENT');
    expect(decision.reason).toBe('the review is incomplete');
  });
});

describe('one-new-commit rule', () => {
  it('returns NONE when the same head already has a request-changes review', () => {
    const options = args({ previousReview: { blocking: true, headSha: 'head-sha' } });
    const decision = decideReview(options);
    expect(decision).toEqual({
      event: 'NONE',
      reason: 'approval requires a new commit',
      dismissBlocking: false,
    });
  });

  it('approves after a new commit', () => {
    const options = args({ previousReview: { blocking: true, headSha: 'older-sha' } });
    const decision = decideReview(options);
    expect(decision.event).toBe('APPROVE');
  });
});

describe('diff anchoring', () => {
  /**
   * Builds one validated finding.
   * @param line - Added line number.
   * @returns Finding.
   */
  const finding = (line: number): Record<string, unknown> => ({
    severity: 'critical',
    path: 'src/a.ts',
    line,
    title: 'Finding',
    body: 'Body',
  });

  /**
   * Wraps findings in a review result.
   * @param findings - Validated findings.
   * @returns Review result.
   */
  const review = (findings: Record<string, unknown>[]): Record<string, unknown> => ({
    summary: 'ok',
    guidelines_read: ['AGENTS.md'],
    findings,
    complete: true,
  });

  it('rejects a result with an off-diff finding', () => {
    const added = new Map([['src/a.ts', new Set([2])]]);
    const offDiff = review([finding(2), finding(9)]);
    expect(() => {
      validateReview(offDiff, 30, added);
    }).toThrow('finding outside the reviewed diff');
    const anchored = review([finding(2)]);
    expect(() => {
      validateReview(anchored, 30, added);
    }).not.toThrow();
  });

  it('checks every finding before applying the cap', () => {
    const added = new Map([['src/a.ts', new Set([2])]]);
    const findings = review([finding(2), finding(2), finding(9)]);
    expect(() => {
      validateReview(findings, 2, added);
    }).toThrow('finding outside the reviewed diff');
  });

  it('applies the cap after a valid anchor check', () => {
    const added = new Map([['src/a.ts', new Set([2])]]);
    const findings = review([finding(2), finding(2)]);
    const result = validateReview(findings, 1, added);
    expect(result.findings).toHaveLength(1);
  });
  it('keeps a blocker beyond the presentation cap for the decision', () => {
    const added = new Map([['src/a.ts', new Set([2])]]);
    const findings: Record<string, unknown>[] = Array.from({ length: 30 }, (_, index) => ({
      ...finding(2),
      title: `Critical ${String(index)}`,
    }));
    findings.push({ ...finding(2), severity: 'important', title: 'Only blocker' });
    const raw = review(findings);
    const capped = validateReview(raw, 30, added);
    const all = validateReview(raw, Number.POSITIVE_INFINITY, added);
    const config = { ...CONFIG, blockingSeverities: ['important'] };
    const cappedArgs = args({ command: 'review', findings: capped.findings, config });
    const allArgs = args({ command: 'review', findings: all.findings, config });
    const cappedDecision = decideReview(cappedArgs);
    const allDecision = decideReview(allArgs);
    expect(cappedDecision.event).toBe('COMMENT');
    expect(allDecision.event).toBe('REQUEST_CHANGES');
  });
});

describe('review marker event', () => {
  const appLogin = 'review-agent[bot]';

  it('ignores prose that mentions a blocking event', () => {
    const reviews = [
      {
        user: { login: appLogin },
        commit_id: 'head-sha',
        body: '<!-- opencode-review-agent event=COMMENT comment=1 -->\n\nThe old event=REQUEST_CHANGES is discussed here.',
      },
    ];
    const isBlocking = hasBlockingReview(reviews, appLogin, 'head-sha');
    expect(isBlocking).toBe(false);
  });

  it('reads the blocking event from the first-line marker', () => {
    const reviews = [
      {
        user: { login: appLogin },
        commit_id: 'head-sha',
        body: '<!-- opencode-review-agent event=REQUEST_CHANGES comment=1 -->',
      },
    ];
    const isBlocking = hasBlockingReview(reviews, appLogin, 'head-sha');
    expect(isBlocking).toBe(true);
  });
});

describe('blocking severity configuration', () => {
  it('honours a custom blocking severity list', () => {
    const config = { ...CONFIG, blockingSeverities: ['critical'] };
    const isImportantBlocking = hasBlockingFindings([{ severity: 'important' }], config);
    const isCriticalBlocking = hasBlockingFindings([{ severity: 'critical' }], config);
    expect(isImportantBlocking).toBe(false);
    expect(isCriticalBlocking).toBe(true);
  });
});

describe('workflow environment decision', () => {
  interface IDecisionInputs {
    readonly result: Record<string, unknown>;
    readonly metadata?: Record<string, unknown>;
    readonly diff?: string;
    readonly command?: string;
  }

  /**
   * Runs the environment decision against local files.
   * @param inputs - Result, metadata and diff contents.
   * @param fetchImpl - GitHub test double.
   * @returns The decision.
   */
  async function decideWith(
    inputs: IDecisionInputs,
    fetchImpl: typeof fetch,
  ): Promise<{ event: string; reason: string; dismissBlocking: boolean }> {
    await mkdir('.review', { recursive: true });
    const tempPrefix = join('.review', 'pr-review-approval-');
    const dir = await mkdtemp(tempPrefix);
    try {
      const resultPath = join(dir, 'result.json');
      const resultText = JSON.stringify(inputs.result);
      await writeFile(resultPath, resultText, 'utf8');
      const metadataPath = join(dir, 'metadata.json');
      const metadata = inputs.metadata ?? CLEAN_METADATA;
      const metadataText = JSON.stringify(metadata);
      await writeFile(metadataPath, metadataText, 'utf8');
      const diffPath = join(dir, 'diff.patch');
      await writeFile(diffPath, inputs.diff ?? '', 'utf8');
      const env = {
        REVIEW_RESULT: resultPath,
        REVIEW_METADATA: metadataPath,
        REVIEW_DIFF: diffPath,
        REVIEW_COMMAND: inputs.command ?? 'approve',
        REVIEW_ACTOR: 'maintainer',
        REVIEW_ACTOR_PERMISSION: 'write',
        REVIEW_HEAD_SHA: 'head-sha',
        REVIEW_REPO: 'sergienko4/repo',
        REVIEW_TOKEN: 'token',
        PR_NUMBER: '886',
      };
      return await decideFromEnv(env, fetchImpl);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Serves no reviews and the live pull request.
   * @param input - Fetch input.
   * @returns Fake response.
   */
  const cleanFetch: typeof fetch = input => {
    const url = urlOf(input);
    if (url.includes('/reviews')) return responseTo([]);
    return responseTo({
      state: 'open',
      draft: false,
      user: { login: 'author' },
      head: { sha: 'head-sha', repo: { full_name: 'sergienko4/repo' } },
    });
  };

  /**
   * Fails the review-history read and serves the live pull request.
   * @param input - Fetch input.
   * @returns Fake response.
   */
  const failingHistoryFetch: typeof fetch = input => {
    const url = urlOf(input);
    if (url.includes('/reviews')) {
      return Promise.resolve(new Response('', { status: 500 }));
    }
    return responseTo({
      state: 'open',
      draft: false,
      user: { login: 'author' },
      head: { sha: 'head-sha', repo: { full_name: 'sergienko4/repo' } },
    });
  };

  it('decides an informational comment with best-effort history', async () => {
    const decision = await decideWith(
      {
        command: 'review',
        result: { summary: 'ok', findings: [], complete: false },
      },
      failingHistoryFetch,
    );
    expect(decision).toEqual({
      event: 'COMMENT',
      reason: 'clean review',
      dismissBlocking: false,
    });
  });

  it('decides a blocking review with best-effort history', async () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +2,1 @@',
      '+blocking',
    ].join('\n');
    const decision = await decideWith(
      {
        command: 'review',
        diff,
        result: {
          summary: 'blocking',
          guidelines_read: ['AGENTS.md'],
          complete: true,
          findings: [{ severity: 'critical', path: 'src/a.ts', line: 2, title: 't', body: 'b' }],
        },
      },
      failingHistoryFetch,
    );
    expect(decision.event).toBe('REQUEST_CHANGES');
  });

  it('requires complete history for a dismissal', async () => {
    const pending = decideWith(
      {
        command: 'review',
        result: { summary: 'ok', guidelines_read: ['AGENTS.md'], findings: [], complete: true },
      },
      failingHistoryFetch,
    );
    await expect(pending).rejects.toThrow('GitHub reviews answered 500');
  });

  it('maps a clean approval environment to APPROVE', async () => {
    const decision = await decideWith(
      { result: { summary: 'ok', guidelines_read: ['AGENTS.md'], findings: [], complete: true } },
      cleanFetch,
    );
    expect(decision).toEqual({
      event: 'APPROVE',
      reason: 'clean review',
      dismissBlocking: false,
    });
  });

  it('fails closed when the review history exceeds the page cap', async () => {
    /**
     * Serve a full review page and the live pull request.
     * @param input - Fetch input.
     * @returns Fake response.
     */
    const fetchImpl: typeof fetch = input => {
      const url = urlOf(input);
      if (url.includes('/reviews')) {
        const page = Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          user: { login: 'someone' },
          body: 'review',
        }));
        return responseTo(page);
      }
      return responseTo({
        state: 'open',
        draft: false,
        user: { login: 'author' },
        head: { sha: 'head-sha', repo: { full_name: 'sergienko4/repo' } },
      });
    };
    const pending = decideWith(
      { result: { summary: 'ok', guidelines_read: ['AGENTS.md'], findings: [], complete: true } },
      fetchImpl,
    );
    await expect(pending).rejects.toThrow('review history is incomplete');
  });

  it('rejects a result with an off-diff finding', async () => {
    const result = {
      summary: 'ok',
      guidelines_read: ['AGENTS.md'],
      complete: true,
      findings: [
        {
          severity: 'critical',
          path: 'src/a.ts',
          line: 2,
          title: 'Anchored',
          body: 'Body',
        },
        {
          severity: 'suggestion',
          path: 'src/a.ts',
          line: 9,
          title: 'Off diff',
          body: 'Body',
        },
      ],
    };
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1,2 @@',
      ' context',
      '+added',
    ].join('\n');
    const pending = decideWith({ result, diff }, cleanFetch);
    await expect(pending).rejects.toThrow('finding outside the reviewed diff');
  });
});
