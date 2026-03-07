export interface IInitUser {
  firstName: string;
  lastName: string;
  custFullName: string;
  custExtId: string; // Israeli national ID
  custIntrId: string;
  is2FAIdentification: boolean;
  email: string | null;
  cellularPhoneNumber: string | null;
  userType: number;
  accountLastEntryDate: string | null;
}

export interface IInitCard {
  cardUniqueId: string;
  last4Digits: string;
  cardNumType: number;
  companyDescription: string;
  cardType: string;
  cardTypeCode: string;
  cardDescription: string;
  isTemporaryCard: boolean;
  currentDebitDay: number;
  isLeadingCard: boolean;
  isVirtualCard: boolean;
  isDigitalCard: boolean;
  isCardWithActivity: boolean;
  bankAccountUniqueId: string;
  isGoodCard: boolean;
}

export interface IInitBankAccount {
  bankAccountUniqueId: string;
  bankBranchNum: string;
  bankAccountNum: string;
  bankName: string;
  bankNameForDashboard: string;
  originalBankCode: number;
  isDefault: boolean;
}

export interface IInitResponse {
  statusCode: number; // 1 = success
  statusDescription: string | null;
  statusTitle: string | null;
  groupPid: string | null;
  result: {
    user: IInitUser;
    cards: IInitCard[];
    bankAccounts: IInitBankAccount[];
  };
}
