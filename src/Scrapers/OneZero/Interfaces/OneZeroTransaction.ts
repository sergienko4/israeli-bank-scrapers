import type { Category } from './Category.js';
import type { Recurrence } from './Recurrence.js';

interface TransactionEnrichment {
  categories?: Category[] | null;
  recurrences?: Recurrence[] | null;
}

export interface OneZeroTransaction {
  enrichment?: TransactionEnrichment | null;
}
