/** Structured details a legacy WAF-block result may carry. */
export interface IWafErrorDetails {
  provider: 'cloudflare' | 'unknown';
  httpStatus: number;
  pageTitle: string;
  pageUrl: string;
  responseSnippet?: string;
  suggestions: string[];
}
