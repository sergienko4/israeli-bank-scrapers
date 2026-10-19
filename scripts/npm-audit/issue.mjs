import { requireAudit } from './input.mjs';
import { AUDIT_MARKER } from './report.mjs';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const TITLE = 'npm dependency audit';
const ISSUE_QUERY = { creator: 'github-actions[bot]', state: 'all', per_page: PAGE_SIZE };

function owned(issue) {
  return (
    !issue.pull_request &&
    issue.user?.login === 'github-actions[bot]' &&
    issue.user?.type === 'Bot' &&
    issue.body?.startsWith(`${AUDIT_MARKER}\n`)
  );
}

async function findIssue(api, repo) {
  const matches = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await issuePage(api, repo, page);
    matches.push(...result.matches);
    requireAudit(matches.length <= 1, 'AUDIT_ISSUE_AMBIGUOUS');
    if (result.complete) return matches[0];
  }
  throw new Error('AUDIT_ISSUE_PAGE_LIMIT');
}

async function issuePage(api, repo, page) {
  const query = { ...repo, ...ISSUE_QUERY, page };
  const { data } = await api.listForRepo(query);
  return { matches: data.filter(owned), complete: data.length < PAGE_SIZE };
}

/**
 * Reuses one marked bot-owned issue; scan failures never call this boundary.
 * @param {import('./issue.d.mts').IIssueApi} api - GitHub issue operations, authenticated only here.
 * @param {{owner: string, repo: string}} repo - Trusted workflow repository.
 * @param {import('./report.d.mts').IAuditReport} report - Successfully validated scan.
 * @returns {Promise<void>} Resolves after persistence, or without creating a clean issue.
 * @throws {Error} Ambiguous ownership, pagination overflow or GitHub request failure.
 */
export async function updateAuditIssue(api, repo, report) {
  requireAudit(typeof report.clean === 'boolean' && report.body.startsWith(`${AUDIT_MARKER}\n`));
  const issue = await findIssue(api, repo);
  if (!issue && report.clean) return;
  if (!issue) return void (await api.create({ ...repo, title: TITLE, body: report.body }));
  const state = report.clean ? 'closed' : 'open';
  const reason = report.clean ? { state_reason: 'completed' } : {};
  await api.update({ ...repo, issue_number: issue.number, body: report.body, state, ...reason });
}
