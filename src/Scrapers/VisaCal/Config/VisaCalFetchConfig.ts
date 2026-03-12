/** Accept-Language header value for VisaCal API requests. */
export const VISA_CAL_ACCEPT_LANGUAGE = 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7';

/** Default HTTP headers for VisaCal API requests. */
export const API_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/142.0.0.0 Safari/537.36',
  'Accept-Language': VISA_CAL_ACCEPT_LANGUAGE,
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};
