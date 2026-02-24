import { type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, type PossibleLoginResults } from './base-scraper-with-browser';
type ScraperSpecificCredentials = {
    username: string;
    password: string;
};
declare class UnionBankScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        postAction: () => Promise<void>;
        possibleResults: PossibleLoginResults;
    };
    fetchData(): Promise<{
        success: boolean;
        accounts: TransactionsAccount[];
    }>;
}
export default UnionBankScraper;
