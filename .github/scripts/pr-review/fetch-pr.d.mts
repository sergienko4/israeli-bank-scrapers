export function isSensitivePath(path: string): boolean;

export function filterDiff(diff: string): string;

export function truncateDiff(diff: string, maxChars: number): { text: string; truncated: boolean };

export function fetchPrData(args: Record<string, unknown>): Promise<Record<string, unknown>>;
