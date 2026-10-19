import type { IAuditReport } from './report.mjs';

export interface IAuditIssue {
  readonly number: number;
  readonly user: { readonly login: string; readonly type: string } | null;
  readonly body: string | null;
  readonly state: string;
  readonly pull_request?: object;
}
interface IRepo {
  readonly owner: string;
  readonly repo: string;
}
export interface IIssueApi {
  listForRepo(
    args: IRepo & {
      creator: string;
      state: 'all';
      per_page: number;
      page: number;
    },
  ): Promise<{ data: IAuditIssue[] }>;
  create(args: IRepo & { title: string; body: string }): Promise<unknown>;
  update(
    args: IRepo & {
      issue_number: number;
      body: string;
      state: 'open' | 'closed';
      state_reason?: 'completed';
    },
  ): Promise<unknown>;
}
export function updateAuditIssue(api: IIssueApi, repo: IRepo, report: IAuditReport): Promise<void>;
