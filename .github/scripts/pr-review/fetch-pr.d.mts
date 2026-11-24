export function isSensitivePath(path: string): boolean;

export function isSensitiveFile(file: Record<string, unknown>): boolean;

export function hasCredentialContent(text: string): boolean;

export function filterDiff(diff: string): string;

export function filterDiffWithReport(diff: string): {
  text: string;
  dropped: number;
  credential: number;
  sensitive: number;
  unparsable: number;
};

export function truncateDiff(diff: string, maxChars: number): { text: string; truncated: boolean };

export function fetchPrData(args: Record<string, unknown>): Promise<Record<string, unknown>>;
