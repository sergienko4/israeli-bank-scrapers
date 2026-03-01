export interface Category {
  categoryId: number;
  dataSource: string;
  subCategoryId?: number | null;
}

export interface Recurrence {
  dataSource: string;
  isRecurrent: boolean;
}

interface TransactionEnrichment {
  categories?: Category[] | null;
  recurrences?: Recurrence[] | null;
}

export interface OneZeroTransaction {
  enrichment?: TransactionEnrichment | null;
}

export interface Movement {
  accountId: string;
  bankCurrencyAmount: string;
  bookingDate: string;
  conversionRate: string;
  creditDebit: string;
  description: string;
  isReversed: boolean;
  movementAmount: string;
  movementCurrency: string;
  movementId: string;
  movementReversedId?: string | null;
  movementTimestamp: string;
  movementType: string;
  portfolioId: string;
  runningBalance: string;
  transaction?: OneZeroTransaction | null;
  valueDate: string;
}

export interface QueryPagination {
  hasMore: boolean;
  cursor: string;
}

export interface Account {
  accountId: string;
}

export interface Portfolio {
  accounts: Account[];
  portfolioId: string;
  portfolioNum: string;
}

export interface Customer {
  customerId: string;
  portfolios?: Portfolio[] | null;
}

export type ScraperSpecificCredentials = { email: string; password: string } & (
  | { otpCodeRetriever: () => Promise<string>; phoneNumber: string }
  | { otpLongTermToken: string }
);
