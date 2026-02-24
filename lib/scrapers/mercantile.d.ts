import DiscountScraper from './discount';
type ScraperSpecificCredentials = {
    id: string;
    password: string;
    num: string;
};
declare class MercantileScraper extends DiscountScraper {
    getLoginOptions(credentials: ScraperSpecificCredentials): {
        loginUrl: string;
        checkReadiness: () => Promise<void>;
        fields: {
            selector: string;
            value: string;
        }[];
        submitButtonSelector: string;
        postAction: () => Promise<void>;
        possibleResults: import("./base-scraper-with-browser").PossibleLoginResults;
    };
}
export default MercantileScraper;
