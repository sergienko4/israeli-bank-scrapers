import type { ICategory } from './Category';
import type { IRecurrence } from './Recurrence';

interface ITransactionEnrichment {
  categories?: ICategory[] | null;
  recurrences?: IRecurrence[] | null;
}

export interface IOneZeroTransaction {
  enrichment?: ITransactionEnrichment | null;
}
