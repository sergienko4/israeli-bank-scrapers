export function sanitizeText(value: unknown): string;

export function readQuotedToken(text: string): string | undefined;

export function decodeQuotedPath(token: string): string | undefined;

export function parsePatchPath(value: string, prefix: 'a' | 'b'): string | null | undefined;
