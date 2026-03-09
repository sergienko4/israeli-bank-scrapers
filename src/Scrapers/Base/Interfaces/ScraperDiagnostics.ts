export interface IScraperDiagnostics {
  loginUrl: string;
  finalUrl?: string;
  loginDurationMs?: number;
  fetchDurationMs?: number;
  lastAction: string;
  pageTitle?: string;
  warnings: string[];
}
