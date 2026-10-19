import {
  type IAuditIssue,
  type IIssueApi,
  updateAuditIssue,
} from '../../../../scripts/npm-audit/issue.mjs';
import { buildAuditReport } from '../../../../scripts/npm-audit/report.mjs';
import { cleanAudit, toolingAudit } from '../../Helpers/NpmAuditFixtures.js';

const REPO = { owner: 'owner', repo: 'repo' };
const TOOLING = toolingAudit();
const EMPTY = cleanAudit();
const FOUND = buildAuditReport(TOOLING, EMPTY);
const CLEAN = buildAuditReport(EMPTY, EMPTY);
/** External failure from the isolated issue API. */
class OfflineFixtureError extends Error {}

/**
 * Builds an issue with explicit ownership.
 * @param bot Whether the workflow owns it.
 * @param state Open or closed.
 * @returns A marked issue.
 */
function issue(bot = true, state = 'open'): IAuditIssue {
  const user = bot
    ? { login: 'github-actions[bot]', type: 'Bot' }
    : { login: 'human', type: 'User' };
  return { number: 42, user, body: FOUND.body, state };
}

/**
 * Records issue operations without remote side effects.
 * @param pages Paginated GitHub responses.
 * @returns Typed API and recorded writes.
 */
function client(pages: readonly (readonly IAuditIssue[])[]): {
  api: IIssueApi;
  writes: Record<string, unknown>[];
} {
  const writes: Record<string, unknown>[] = [];
  /**
   * Records a create or update operation.
   * @param args Mutation fields.
   * @returns Successful persistence.
   */
  const record = (
    args: Parameters<IIssueApi['create']>[0] | Parameters<IIssueApi['update']>[0],
  ): Promise<unknown> => {
    writes.push({ ...args });
    return Promise.resolve();
  };
  const api: IIssueApi = {
    /**
     * Supplies one isolated page.
     * @param args Pagination query.
     * @returns The corresponding page.
     */
    listForRepo: args => Promise.resolve({ data: [...(pages[args.page - 1] ?? [])] }),
    create: record,
    update: record,
  };
  return { api, writes };
}

describe('npm advisory issue lifecycle', () => {
  it('[NAI-1] creates a report for findings, preserving a human-created issue', async () => {
    const { api, writes } = client([[issue(false)]]);
    await updateAuditIssue(api, REPO, FOUND);
    expect(writes).toEqual([{ ...REPO, title: 'npm dependency audit', body: FOUND.body }]);
  });

  it('[NAI-2] edits the same owned issue without comments or duplicate creation', async () => {
    const { api, writes } = client([[issue()]]);
    await updateAuditIssue(api, REPO, FOUND);
    expect(writes).toEqual([{ ...REPO, issue_number: 42, body: FOUND.body, state: 'open' }]);
  });

  it('[NAI-3] closes only its own report after a clean scan', async () => {
    const { api, writes } = client([[issue(false), issue()]]);
    await updateAuditIssue(api, REPO, CLEAN);
    expect(writes).toEqual([
      { ...REPO, issue_number: 42, body: CLEAN.body, state: 'closed', state_reason: 'completed' },
    ]);
  });

  it('[NAI-4] clean/no-existing-report scans create nothing', async () => {
    const { api, writes } = client([[issue(false)]]);
    await updateAuditIssue(api, REPO, CLEAN);
    expect(writes).toEqual([]);
  });

  it('[NAI-5] reopens the existing closed report when an advisory recurs', async () => {
    const { api, writes } = client([[issue(true, 'closed')]]);
    await updateAuditIssue(api, REPO, FOUND);
    expect(writes[0]).toMatchObject({ issue_number: 42, state: 'open' });
  });

  it('[NAI-6] ignores bot issues without the ownership marker and pull requests', async () => {
    const unrelated = { ...issue(), body: 'unrelated' };
    const pullRequest = { ...issue(), pull_request: {} };
    const { api, writes } = client([[unrelated, pullRequest]]);
    await updateAuditIssue(api, REPO, FOUND);
    expect(writes[0]).not.toHaveProperty('issue_number');
  });

  it('[NAI-7] reads subsequent pages before choosing a report', async () => {
    const firstPage = Array.from({ length: 100 }, (): IAuditIssue => issue(false));
    const { api, writes } = client([firstPage, [issue()]]);
    await updateAuditIssue(api, REPO, FOUND);
    expect(writes[0]).toMatchObject({ issue_number: 42 });
  });

  it.each(['ambiguous', 'overflow'])(
    '[NAI-8] refuses %s ownership without writing',
    async scenario => {
      const full = Array.from({ length: 100 }, (): IAuditIssue => issue(false));
      const overflow = Array.from({ length: 10 }, (): IAuditIssue[] => full);
      const pages = scenario === 'ambiguous' ? [[issue(), issue()]] : overflow;
      const { api, writes } = client(pages);
      const update = updateAuditIssue(api, REPO, FOUND);
      await expect(update).rejects.toThrow('AUDIT_ISSUE');
      expect(writes).toEqual([]);
    },
  );

  it('[NAI-9] propagates GitHub failures, retaining the previous report', async () => {
    const { api, writes } = client([[issue()]]);
    /**
     * Rejects the external request.
     * @returns Failed network operation.
     */
    api.listForRepo = (): ReturnType<IIssueApi['listForRepo']> =>
      Promise.reject(new OfflineFixtureError('offline'));
    const update = updateAuditIssue(api, REPO, CLEAN);
    await expect(update).rejects.toThrow('offline');
    expect(writes).toEqual([]);
  });
});
