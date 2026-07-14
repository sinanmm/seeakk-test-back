import { parsePhoneNumberFromString } from 'libphonenumber-js';

const countryRules: Record<string, { name: string; digits?: number; message?: string }> = {
  IN: { name: 'Indian', digits: 10 },
  AE: { name: 'UAE', digits: 9 },
  SA: { name: 'Saudi Arabia', digits: 9 },
  QA: { name: 'Qatar', digits: 8 },
  OM: { name: 'Oman', digits: 8 },
  KW: { name: 'Kuwait', digits: 8 },
  US: { name: 'US', digits: 10 },
  CA: { name: 'Canadian', digits: 10 },
  GB: { name: 'UK', message: 'Invalid UK mobile number.' },
};

export function validatePhoneStr(phoneStr: string | null | undefined): { isValid: boolean; message?: string } {
  if (!phoneStr) return { isValid: true };
  const clean = phoneStr.trim();
  if (clean === '') return { isValid: true };

  // Must start with +
  if (!clean.startsWith('+')) {
    return { isValid: false, message: 'Phone number must start with + followed by the country code.' };
  }

  const parsed = parsePhoneNumberFromString(clean);
  if (!parsed) {
    return { isValid: false, message: 'Invalid phone number format.' };
  }

  const country = parsed.country;
  if (!country) {
    return { isValid: false, message: 'Invalid country dial code.' };
  }

  const rule = countryRules[country];
  if (rule) {
    if (rule.digits !== undefined) {
      // National number is parsed.nationalNumber
      const national = parsed.nationalNumber;
      if (national.length !== rule.digits) {
        const countryLabel = rule.name;
        return {
          isValid: false,
          message: `${countryLabel} mobile numbers must contain exactly ${rule.digits} digits.`,
        };
      }
    }
  }

  // Fallback to libphonenumber-js validation
  if (!parsed.isValid()) {
    const countryName = rule?.name || country;
    return {
      isValid: false,
      message: rule?.message || `Invalid phone number format for ${countryName}.`,
    };
  }

  return { isValid: true };
}

export function formatPhoneStr(phoneStr: string | null | undefined): string {
  if (!phoneStr) return '';
  const clean = phoneStr.trim();
  if (clean === '') return '';

  if (clean.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(clean);
    if (parsed && parsed.isValid()) {
      return parsed.formatInternational();
    }
  } else {
    const parsed = parsePhoneNumberFromString(clean, 'IN');
    if (parsed && parsed.isValid()) {
      return parsed.formatInternational();
    }
  }
  return clean;
}

export function cleanAndParseImportedPhone(rawPhone: string): string | null {
  const clean = rawPhone.trim().replace(/[\s-()]/g, '');
  if (!clean) return null;

  // Case 1: Starts with + already
  if (clean.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(clean);
    if (parsed && parsed.isValid()) {
      return parsed.number;
    }
    return clean;
  }

  // Case 2: Starts with digit, check if adding + makes it a valid international number
  const plusAdded = '+' + clean;
  const parsedPlus = parsePhoneNumberFromString(plusAdded);
  if (parsedPlus && parsedPlus.isValid()) {
    return parsedPlus.number;
  }

  // Case 3: Parse as India (+91) default since it's the workspace default
  const parsedIn = parsePhoneNumberFromString(clean, 'IN');
  if (parsedIn && parsedIn.isValid()) {
    return parsedIn.number;
  }

  // Case 4: Fallback checks for clean digit length
  const onlyDigits = clean.replace(/\D/g, '');
  if (onlyDigits) {
    if (onlyDigits.length === 10) {
      return '+91' + onlyDigits;
    }
    if (onlyDigits.length === 9) {
      return '+971' + onlyDigits;
    }
    if (onlyDigits.length === 10 && onlyDigits.startsWith('0')) {
      return '+971' + onlyDigits.substring(1);
    }
    return '+' + onlyDigits;
  }

  return null;
}
