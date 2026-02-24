import { type Transaction } from '../transactions';
import { BaseScraperWithBrowser, type PossibleLoginResults } from './base-scraper-with-browser';
type ScraperSpecificCredentials = {
    id: string;
    password: string;
};
declare class BeyahadBishvilhaScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    protected getViewPort(): {
        width: number;
        height: number;
    };
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: () => Promise<void>;
        possibleResults: PossibleLoginResults;
    };
    fetchData(): Promise<{
        success: boolean;
        accounts: {
            accountNumber: any;
            balance: number;
            txns: Transaction[];
        }[];
    }>;
}
export default BeyahadBishvilhaScraper;
