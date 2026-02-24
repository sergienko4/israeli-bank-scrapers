export declare enum ScraperErrorTypes {
    TwoFactorRetrieverMissing = "TWO_FACTOR_RETRIEVER_MISSING",
    InvalidPassword = "INVALID_PASSWORD",
    ChangePassword = "CHANGE_PASSWORD",
    Timeout = "TIMEOUT",
    AccountBlocked = "ACCOUNT_BLOCKED",
    Generic = "GENERIC",
    General = "GENERAL_ERROR"
}
export type ErrorResult = {
    success: false;
    errorType: ScraperErrorTypes;
    errorMessage: string;
};
export declare function createTimeoutError(errorMessage: string): ErrorResult;
export declare function createGenericError(errorMessage: string): ErrorResult;
