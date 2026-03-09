import type { ICategory } from './Category.js';
import type { IRecurrence } from './Recurrence.js';

interface ITransactionEnrichment {
  categories?: ICategory[] | null;
  recurrences?: IRecurrence[] | null;
}

export interface IOneZeroTransaction {
  enrichment?: ITransactionEnrichment | null;
}
