export const HEBREW_TRANSACTION_TYPES = [
  'העברה בנקאית',
  "צ'ק",
  'הוראת קבע',
  'עמלה בנקאית',
  'משיכה מכספומט',
  'הפקדה',
  'ריבית',
  'תשלום תקופתי',
] as const;

export const HEBREW_MERCHANTS = [
  'שופרסל אונליין',
  'דלק סוקנים',
  'בזק טלקום',
  'חברת החשמל',
  'מסעדת הבית',
  'בית מרקחת סופר-פארם',
  'סלקום',
  'קפה גרג',
] as const;

export const HEBREW_ERROR_MESSAGES = {
  invalidCredentials: 'תעודת זהות או סיסמה שגויה',
  sessionTimeout: 'פג התוקף של ההפעלה שלך',
  otpRequired: 'נדרשת אישור דו-שלבי',
  invalidOtp: 'קוד OTP שגוי',
  accountLocked: 'החשבון נחסם זמנית',
} as const;
