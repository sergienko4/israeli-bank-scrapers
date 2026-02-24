import { type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, type PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
type ScraperSpecificCredentials = {
    username: string;
    password: string;
};
declare class MizrahiScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        checkReadiness: () => Promise<void>;
        postAction: () => Promise<void>;
        possibleResults: PossibleLoginResults;
    };
    fetchData(): Promise<{
        success: boolean;
        accounts: TransactionsAccount[];
        errorType?: undefined;
        errorMessage?: undefined;
    } | {
        success: boolean;
        errorType: ScraperErrorTypes;
        errorMessage: string;
        accounts?: undefined;
    }>;
    private getPendingTransactions;
    private fetchAccount;
    private shouldMarkAsPending;
}
export default MizrahiScraper;
