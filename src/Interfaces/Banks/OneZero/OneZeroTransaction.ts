import type { Category } from './Category';
import type { Recurrence } from './Recurrence';

interface TransactionEnrichment {
  categories?: Category[] | null;
  recurrences?: Recurrence[] | null;
}

export interface OneZeroTransaction {
  enrichment?: TransactionEnrichment | null;
}
