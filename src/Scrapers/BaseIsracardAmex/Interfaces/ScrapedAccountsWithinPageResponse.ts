export interface ScrapedAccountsWithinPageResponse {
  Header: { Status: string };
  DashboardMonthBean?: {
    cardsCharges?: { cardIndex: string; cardNumber: string; billingDate: string }[];
  };
}
