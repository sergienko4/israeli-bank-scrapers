export const SHEKEL_CURRENCY_SYMBOL = '₪';
export const SHEKEL_CURRENCY_KEYWORD = 'ש"ח';
export const ALT_SHEKEL_CURRENCY = 'NIS';
export const SHEKEL_CURRENCY = 'ILS';

export const DOLLAR_CURRENCY_SYMBOL = '$';
export const DOLLAR_CURRENCY = 'USD';

export const EURO_CURRENCY_SYMBOL = '€';
export const EURO_CURRENCY = 'EUR';

export const ISO_DATE_FORMAT = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';

const ISO_DATE_PATTERN = [
  '^\\d{4}-(0[1-9]|1[0-2])',
  '-(0[1-9]|[12]\\d|3[01])',
  'T([01]\\d|2[0-3])',
  '(:[0-5]\\d){2}',
  '\\.\\d{3}Z$',
].join('');

export const ISO_DATE_REGEX = new RegExp(ISO_DATE_PATTERN);
