export interface IInitResponse {
  result: {
    cards: {
      cardUniqueId: string;
      last4Digits: string;
      [key: string]: unknown;
    }[];
  };
}
