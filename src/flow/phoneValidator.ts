export type PhoneErrorType = 'missing' | 'excess' | 'invalidPrefix';

export interface PhoneCheckResult {
  valid: boolean;
  normalizedPhone: string | null;
  errorType: PhoneErrorType | null;
}

const VALID_PHONE_REGEX = /^0(3|5|7|8|9)\d{8}$/;
const DIGIT_RUN_REGEX = /\d[\d\s.-]{7,}\d|\d{8,}/;

function extractDigitRun(text: string): string | null {
  const match = text.match(DIGIT_RUN_REGEX);
  if (!match) return null;
  return match[0];
}

function stripSeparators(raw: string): string {
  return raw.replace(/[\s.-]/g, '');
}

function normalizeCountryCode(digits: string): string {
  if (digits.startsWith('84') && digits.length > 10) {
    return '0' + digits.slice(2);
  }
  return digits;
}

const NOT_A_PHONE: PhoneCheckResult = { valid: false, normalizedPhone: null, errorType: null };

export function checkPhone(text: string): PhoneCheckResult {
  const rawDigitRun = extractDigitRun(text);
  if (!rawDigitRun) {
    return NOT_A_PHONE;
  }

  const stripped = stripSeparators(rawDigitRun);
  const normalized = normalizeCountryCode(stripped);

  if (!/^\d+$/.test(normalized)) {
    return NOT_A_PHONE;
  }

  if (VALID_PHONE_REGEX.test(normalized)) {
    return { valid: true, normalizedPhone: normalized, errorType: null };
  }

  if (normalized.length < 10) {
    return { valid: false, normalizedPhone: normalized, errorType: 'missing' };
  }

  if (normalized.length > 10) {
    return { valid: false, normalizedPhone: normalized, errorType: 'excess' };
  }

  return { valid: false, normalizedPhone: normalized, errorType: 'invalidPrefix' };
}
