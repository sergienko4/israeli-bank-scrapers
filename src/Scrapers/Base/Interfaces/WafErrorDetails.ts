export interface IWafErrorDetails {
  provider: 'cloudflare' | 'unknown';
  httpStatus: number;
  pageTitle: string;
  pageUrl: string;
  responseSnippet?: string;
  suggestions: string[];
}
