/**
 * Derive a stable kebab-case logger name from the caller's `import.meta.url`.
 *
 * Extracted from the legacy {@link ../Types/Debug.ts} blob during Phase
 * 12c. Architectural Force: callers MUST pass `import.meta.url`; the
 * logger name is derived from the source filename — no manual name
 * strings — so logs are guaranteed to point at a real file on disk.
 */

import type { Brand } from '../Types/Brand.js';

/** URL basename string — branded for Rule #15. */
type UrlBasename = Brand<string, 'UrlBasename'>;
/** Kebab-cased logger name derived from a source filename. */
export type LoggerNameKebab = Brand<string, 'LoggerNameKebab'>;

/** File-extension regex used by `deriveLogName` (non-capturing). */
const FILE_EXT_RE = /\.(?:ts|js|tsx|jsx|mjs|cjs)$/;
/** PascalCase split regex for kebab-casing. */
const PASCAL_SPLIT_RE = /([a-z0-9])([A-Z])/g;

/**
 * Take the basename of a `file:///` URL — the part after the last `/`.
 * @param metaUrl - The caller's `import.meta.url`.
 * @returns The filename portion (or the input itself if no `/` present).
 */
function basenameFromUrl(metaUrl: string): UrlBasename {
  const cleaned = metaUrl.split('?')[0].split('#')[0];
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash < 0) return cleaned as UrlBasename;
  return cleaned.substring(lastSlash + 1) as UrlBasename;
}

/**
 * Derive the logger name from `import.meta.url`. The caller passes
 * `import.meta.url` (a `file:///...` URL); we extract the basename,
 * drop the extension, and kebab-case PascalCase. So
 * `file:///.../Mediator/Elements/ActionExecutors.ts` becomes
 * `action-executors`. No manual logger name strings anywhere.
 * @param metaUrl - The caller's `import.meta.url`.
 * @returns Kebab-cased module name.
 */
export function deriveLogName(metaUrl: string): LoggerNameKebab {
  const last = basenameFromUrl(metaUrl);
  const stem = last.replace(FILE_EXT_RE, '');
  const kebab = stem.replaceAll(PASCAL_SPLIT_RE, '$1-$2').toLowerCase();
  return kebab as LoggerNameKebab;
}
