export const normalizePhoneForWhatsApp = (phone?: string | null): string | null => {
  if (!phone) return null;

  // Remove non-numeric characters except leading +
  let cleaned = phone.trim().replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // Remove leading zeros if any
  cleaned = cleaned.replace(/^0+/, '');

  // If phone is 10 digits (national format in many regions), prefix default country code 91 if applicable or keep
  if (cleaned.length === 10) {
    return `91${cleaned}`;
  }

  if (cleaned.length >= 7 && cleaned.length <= 15) {
    return cleaned;
  }

  return null;
};

export const buildWhatsAppClickToChatUrl = (phone?: string | null, message?: string | null): string | null => {
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) return null;

  const encodedMessage = message ? encodeURIComponent(message) : '';
  return `https://wa.me/${normalizedPhone}${encodedMessage ? `?text=${encodedMessage}` : ''}`;
};
