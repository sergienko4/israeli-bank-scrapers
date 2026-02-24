export declare const PASSWORD_FIELD = "password";
export declare enum CompanyTypes {
    hapoalim = "hapoalim",
    beinleumi = "beinleumi",
    union = "union",
    amex = "amex",
    isracard = "isracard",
    visaCal = "visaCal",
    max = "max",
    otsarHahayal = "otsarHahayal",
    discount = "discount",
    mercantile = "mercantile",
    mizrahi = "mizrahi",
    leumi = "leumi",
    massad = "massad",
    yahav = "yahav",
    behatsdaa = "behatsdaa",
    beyahadBishvilha = "beyahadBishvilha",
    oneZero = "oneZero",
    pagi = "pagi"
}
export declare const SCRAPERS: {
    hapoalim: {
        name: string;
        loginFields: string[];
    };
    leumi: {
        name: string;
        loginFields: string[];
    };
    mizrahi: {
        name: string;
        loginFields: string[];
    };
    discount: {
        name: string;
        loginFields: string[];
    };
    mercantile: {
        name: string;
        loginFields: string[];
    };
    otsarHahayal: {
        name: string;
        loginFields: string[];
    };
    max: {
        name: string;
        loginFields: string[];
    };
    visaCal: {
        name: string;
        loginFields: string[];
    };
    isracard: {
        name: string;
        loginFields: string[];
    };
    amex: {
        name: string;
        loginFields: string[];
    };
    union: {
        name: string;
        loginFields: string[];
    };
    beinleumi: {
        name: string;
        loginFields: string[];
    };
    massad: {
        name: string;
        loginFields: string[];
    };
    yahav: {
        name: string;
        loginFields: string[];
    };
    beyahadBishvilha: {
        name: string;
        loginFields: string[];
    };
    oneZero: {
        name: string;
        loginFields: string[];
    };
    behatsdaa: {
        name: string;
        loginFields: string[];
    };
    pagi: {
        name: string;
        loginFields: string[];
    };
};
export declare enum ScraperProgressTypes {
    Initializing = "INITIALIZING",
    StartScraping = "START_SCRAPING",
    LoggingIn = "LOGGING_IN",
    LoginSuccess = "LOGIN_SUCCESS",
    LoginFailed = "LOGIN_FAILED",
    ChangePassword = "CHANGE_PASSWORD",
    EndScraping = "END_SCRAPING",
    Terminating = "TERMINATING"
}
