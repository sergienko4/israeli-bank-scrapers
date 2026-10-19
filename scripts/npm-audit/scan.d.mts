import type { IAuditReport } from './report.mjs';

export type AuditRunner = (
  args: string[],
  limits: IAuditLimits,
) => {
  readonly status: number | null;
  readonly stdout: string;
  readonly error?: Error;
};
export interface IAuditLimits {
  readonly encoding: 'utf8';
  readonly timeout: number;
  readonly maxBuffer: number;
}
export function collectAuditReport(run?: AuditRunner): IAuditReport;
