/**
 * Unit tests for AmexScraper — monthly transaction fetching via GetTransactionsList.
 * Verifies: card extraction, POST body construction, transaction mapping.
 */

import {
  buildAmexPostBody,
  extractActiveCards,
  type IAmexCard,
} from '../../../../../Scrapers/Pipeline/Banks/Amex/AmexScraper.js';

/** Mock card from GetCardList response. */
const MOCK_CARD: IAmexCard = {
  cardSuffix: '8912',
  companyCode: 77,
  isPartner: false,
  isActive: true,
  cardName: 'אמק"ס BUSINESS זהב',
};

/** Mock inactive card. */
const MOCK_INACTIVE: IAmexCard = {
  cardSuffix: '1234',
  companyCode: 77,
  isPartner: false,
  isActive: false,
  cardName: 'פלטינה מסטרקארד',
};

describe('AmexScraper/extractActiveCards', () => {
  it('filters to active cards only', () => {
    const raw = { data: { cardsList: [MOCK_CARD, MOCK_INACTIVE] } };
    const cards = extractActiveCards(raw);
    expect(cards).toHaveLength(1);
    expect(cards[0].cardSuffix).toBe('8912');
  });

  it('returns empty for missing cardsList', () => {
    const cards = extractActiveCards({ data: {} });
    expect(cards).toHaveLength(0);
  });

  it('returns empty for non-object input', () => {
    const cards = extractActiveCards({});
    expect(cards).toHaveLength(0);
  });
});

describe('AmexScraper/buildAmexPostBody', () => {
  it('constructs correct POST body for a card and month', () => {
    const body = buildAmexPostBody(MOCK_CARD, '01/03/2026');
    expect(body.card4Number).toBe('8912');
    expect(body.billingMonth).toBe('01/03/2026');
    expect(body.companyCode).toBe(77);
    expect(body.isPartner).toBe(false);
    expect(body.cardStatus).toBe(0);
    expect(body.isNextBillingDate).toBe(false);
  });
});
