import { fetchPost } from '../../Common/Fetch.js';
import { ID_URL } from './Config/OneZeroConfig.js';

/**
 * Post to the identity server and return the typed response.
 * @param path - The API path after the base URL.
 * @param body - The request body.
 * @returns The typed response.
 */
export async function idPost<T>(path: string, body: Record<string, string>): Promise<T> {
  return fetchPost<T>(`${ID_URL}/${path}`, body);
}

/**
 * Fetch a device token from the identity server.
 * @returns The device token string.
 */
export async function fetchDeviceToken(): Promise<string> {
  const r = await idPost<{ resultData: { deviceToken: string } }>('devices/token', {
    extClientId: 'mobile',
    os: 'Android',
  });
  return r.resultData.deviceToken;
}

/**
 * Send an OTP to the given phone number.
 * @param phone - The full international phone number.
 * @param deviceToken - The device token for the request.
 * @returns The OTP context string.
 */
export async function sendOtp(phone: string, deviceToken: string): Promise<string> {
  const r = await idPost<{ resultData: { otpContext: string } }>('otp/prepare', {
    factorValue: phone,
    deviceToken,
    otpChannel: 'SMS_OTP',
  });
  return r.resultData.otpContext;
}

/**
 * Get an ID token from the identity server.
 * @param otpSmsToken - The OTP SMS token.
 * @param email - The user email.
 * @param pass - The user password.
 * @returns The ID token string.
 */
export async function getIdToken(
  otpSmsToken: string,
  email: string,
  pass: string,
): Promise<string> {
  const r = await idPost<{ resultData: { idToken: string } }>('getIdToken', {
    otpSmsToken,
    email,
    pass,
    pinCode: '',
  });
  return r.resultData.idToken;
}

/**
 * Get a session access token from the identity server.
 * @param idToken - The ID token.
 * @param pass - The user password.
 * @returns The access token string.
 */
export async function getSessionToken(idToken: string, pass: string): Promise<string> {
  const r = await idPost<{ resultData: { accessToken: string } }>('sessions/token', {
    idToken,
    pass,
  });
  return r.resultData.accessToken;
}
