export interface IAuditReport {
  readonly body: string;
  readonly clean: boolean;
}
export const AUDIT_MARKER: string;
export function buildAuditReport(full: unknown, productionOnly: unknown): IAuditReport;
