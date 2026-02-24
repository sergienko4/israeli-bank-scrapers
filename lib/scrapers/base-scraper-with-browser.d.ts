import { type Frame, type Page, type PuppeteerLifeCycleEvent } from 'puppeteer';
import { BaseScraper } from './base-scraper';
import { ScraperErrorTypes } from './errors';
import { type ScraperCredentials, type ScraperScrapingResult } from './interface';
declare enum LoginBaseResults {
    Success = "SUCCESS",
    UnknownError = "UNKNOWN_ERROR"
}
export declare const LoginResults: {
    Success: LoginBaseResults.Success;
    UnknownError: LoginBaseResults.UnknownError;
    TwoFactorRetrieverMissing: ScraperErrorTypes.TwoFactorRetrieverMissing;
    InvalidPassword: ScraperErrorTypes.InvalidPassword;
    ChangePassword: ScraperErrorTypes.ChangePassword;
    AccountBlocked: ScraperErrorTypes.AccountBlocked;
};
export type LoginResults = Exclude<ScraperErrorTypes, ScraperErrorTypes.Timeout | ScraperErrorTypes.Generic | ScraperErrorTypes.General> | LoginBaseResults;
export type PossibleLoginResults = {
    [key in LoginResults]?: (string | RegExp | ((options?: {
        page?: Page;
    }) => Promise<boolean>))[];
};
export interface LoginOptions {
    loginUrl: string;
    checkReadiness?: () => Promise<void>;
    fields: {
        selector: string;
        value: string;
    }[];
    submitButtonSelector: string | (() => Promise<void>);
    preAction?: () => Promise<Frame | void>;
    postAction?: () => Promise<void>;
    possibleResults: PossibleLoginResults;
    userAgent?: string;
    waitUntil?: PuppeteerLifeCycleEvent;
}
declare class BaseScraperWithBrowser<TCredentials extends ScraperCredentials> extends BaseScraper<TCredentials> {
    private cleanups;
    private defaultViewportSize;
    protected page: Page;
    protected getViewPort(): {
        width: number;
        height: number;
    };
    initialize(): Promise<void>;
    private initializePage;
    navigateTo(url: string, waitUntil?: PuppeteerLifeCycleEvent | undefined, retries?: number): Promise<void>;
    getLoginOptions(_credentials: ScraperCredentials): LoginOptions;
    fillInputs(pageOrFrame: Page | Frame, fields: {
        selector: string;
        value: string;
    }[]): Promise<void>;
    login(credentials: ScraperCredentials): Promise<ScraperScrapingResult>;
    terminate(_success: boolean): Promise<void>;
    private handleLoginResult;
}
export { BaseScraperWithBrowser };
