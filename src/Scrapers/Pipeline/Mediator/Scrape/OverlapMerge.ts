/**
 * The page-merge policy for a walk whose pages can re-serve rows.
 *
 * Most walks chunk by date and hand back disjoint pages, so the paginator
 * concatenates and pays nothing. A walk that re-asks its boundary inclusively —
 * the only way to recover rows a row-count cap withheld part-way through a day —
 * gets back rows it already holds, and concatenating would emit them twice.
 *
 * This is the seam between the two. It lives apart from {@link dropOverlap}
 * because that function answers "which of these rows are fresh?", while this one
 * answers "how does a page join the ones before it?" — a paginator concern. The
 * shape declares `pagesMayOverlap` and the collection loop reaches for this;
 * neither has to know how identity is decided.
 */

import { dropOverlap } from './RawOverlap.js';

/** How a page joins the rows already held. */
export type PageMerge = (held: readonly object[], incoming: readonly object[]) => readonly object[];

/**
 * A merge that appends only the rows not already held.
 *
 * @param label - Bank + step identity for the log line; never row content.
 * @returns A merge function for {@link fetchPaginated}.
 */
export function buildOverlapMerge(label: string): PageMerge {
  return (held, incoming): readonly object[] => {
    const fresh = dropOverlap({ collected: held, incoming, label });
    return [...held, ...fresh.kept];
  };
}

export default buildOverlapMerge;
