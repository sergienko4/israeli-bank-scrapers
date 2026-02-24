import { type Transaction } from '../transactions';
import { BaseScraperWithBrowser, type LoginOptions } from './base-scraper-with-browser';
export interface ScrapedTransaction {
    shortCardNumber: string;
    paymentDate?: string;
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
export declare function getMemo({ comments, fundsTransferReceiverOrTransfer, fundsTransferComment, }: Pick<ScrapedTransaction, 'comments' | 'fundsTransferReceiverOrTransfer' | 'fundsTransferComment'>): string;
type ScraperSpecificCredentials = {
    username: string;
    password: string;
};
declare class MaxScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions;
    fetchData(): Promise<{
        success: boolean;
        accounts: {
            accountNumber: string;
            txns: Transaction[];
        }[];
    }>;
}
export default MaxScraper;
