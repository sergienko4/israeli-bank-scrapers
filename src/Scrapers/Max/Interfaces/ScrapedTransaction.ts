export interface IScrapedTransaction {
  shortCardNumber: string;
  paymentDate?: string | null;
  purchaseDate: string;
  actualPaymentAmount: string;
  paymentCurrency: number | null;
  originalCurrency: string;
  originalAmount: number;
  planName: string;
  planTypeId: number;
  comments: string;
  merchantName: string;
  categoryId: number;
  fundsTransferComment?: string;
  fundsTransferReceiverOrTransfer?: string;
  dealData?: {
    arn: string;
  };
}
