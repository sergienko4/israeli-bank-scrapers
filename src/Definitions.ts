// NOTICE: avoid changing exported keys as they are part of the public api

export const PASSWORD_FIELD = 'password';

export enum CompanyTypes {
  Hapoalim = 'hapoalim',
  Beinleumi = 'beinleumi',
  Amex = 'amex',
  Isracard = 'isracard',
  VisaCal = 'visaCal',
  Max = 'max',
  OtsarHahayal = 'otsarHahayal',
  Discount = 'discount',
  Mercantile = 'mercantile',
  Mizrahi = 'mizrahi',
  Leumi = 'leumi',
  Massad = 'massad',
  Yahav = 'yahav',
  Behatsdaa = 'behatsdaa',
  BeyahadBishvilha = 'beyahadBishvilha',
  OneZero = 'oneZero',
  Pagi = 'pagi',
}

export const SCRAPERS = {
  [CompanyTypes.Hapoalim]: {
    name: 'Bank Hapoalim',
    loginFields: ['userCode', PASSWORD_FIELD],
  },
  [CompanyTypes.Leumi]: {
    name: 'Bank Leumi',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.Mizrahi]: {
    name: 'Mizrahi Bank',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.Discount]: {
    name: 'Discount Bank',
    loginFields: ['id', PASSWORD_FIELD, 'num'],
  },
  [CompanyTypes.Mercantile]: {
    name: 'Mercantile Bank',
    loginFields: ['id', PASSWORD_FIELD, 'num'],
  },
  [CompanyTypes.OtsarHahayal]: {
    name: 'Bank Otsar Hahayal',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.Max]: {
    name: 'Max',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.VisaCal]: {
    name: 'Visa Cal',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.Isracard]: {
    name: 'Isracard',
    loginFields: ['id', 'card6Digits', PASSWORD_FIELD],
  },
  [CompanyTypes.Amex]: {
    name: 'Amex',
    loginFields: ['id', 'card6Digits', PASSWORD_FIELD],
  },
  [CompanyTypes.Beinleumi]: {
    name: 'Beinleumi',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.Massad]: {
    name: 'Massad',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.Yahav]: {
    name: 'Bank Yahav',
    loginFields: ['username', 'nationalID', PASSWORD_FIELD],
  },
  [CompanyTypes.BeyahadBishvilha]: {
    name: 'Beyahad Bishvilha',
    loginFields: ['id', PASSWORD_FIELD],
  },
  [CompanyTypes.OneZero]: {
    name: 'One Zero',
    loginFields: ['email', PASSWORD_FIELD, 'otpCodeRetriever', 'phoneNumber', 'otpLongTermToken'],
  },
  [CompanyTypes.Behatsdaa]: {
    name: 'Behatsdaa',
    loginFields: ['id', PASSWORD_FIELD],
  },
  [CompanyTypes.Pagi]: {
    name: 'Pagi',
    loginFields: ['username', PASSWORD_FIELD],
  },
};

export enum ScraperProgressTypes {
  Initializing = 'INITIALIZING',
  StartScraping = 'START_SCRAPING',
  LoggingIn = 'LOGGING_IN',
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailed = 'LOGIN_FAILED',
  ChangePassword = 'CHANGE_PASSWORD',
  EndScraping = 'END_SCRAPING',
  Terminating = 'TERMINATING',
}
