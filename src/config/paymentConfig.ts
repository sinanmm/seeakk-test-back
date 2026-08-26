import logger from '../utils/logger';

export interface PaymentConfig {
  upiId: string | null;
  upiPayeeName: string;
  isConfigured: boolean;
  pricePerUserPerMonth: number;
  currency: string;
  paymentReferencePrefix: string;
}

/**
 * Resolves platform payment receiving configuration strictly from backend environment variables.
 * Never uses placeholder defaults like "yourupi@bank".
 */
export const getPaymentConfig = (): PaymentConfig => {
  const rawUpiId = (process.env.SEEAKK_UPI_ID || '').trim();
  const rawPayeeName = (process.env.SEEAKK_UPI_PAYEE_NAME || '').trim();

  // Validate that UPI ID is present, non-empty, contains '@', and is not a placeholder
  const isPlaceholder = rawUpiId.toLowerCase() === 'yourupi@bank';
  const isValidUpiId = Boolean(
    rawUpiId &&
    rawUpiId.length >= 4 &&
    rawUpiId.includes('@') &&
    !isPlaceholder
  );

  const upiId = isValidUpiId ? rawUpiId : null;
  const upiPayeeName = rawPayeeName || 'SEEAKK';
  const isConfigured = Boolean(upiId);

  return {
    upiId,
    upiPayeeName,
    isConfigured,
    pricePerUserPerMonth: 499,
    currency: 'INR',
    paymentReferencePrefix: 'SEEAKK-PAY',
  };
};

/**
 * Safe startup diagnostics logging that does not log full secrets.
 */
export const logPaymentConfigStatus = (): void => {
  const config = getPaymentConfig();
  if (config.isConfigured) {
    logger.info('UPI payment configuration: configured');
  } else {
    logger.info('UPI payment configuration: not configured');
  }
};
