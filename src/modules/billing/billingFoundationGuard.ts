import { PrismaClient } from '@prisma/client';
import { getPaymentConfig, logPaymentConfigStatus } from '../../config/paymentConfig';

const directPrisma = new PrismaClient();

export const ensureBillingFoundationSeeded = async () => {
  try {
    const paymentConfig = getPaymentConfig();
    logPaymentConfigStatus();

    const existing = await directPrisma.platformBillingSetting.findFirst();
    if (!existing) {
      await directPrisma.platformBillingSetting.create({
        data: {
          pricePerUserPerMonth: paymentConfig.pricePerUserPerMonth,
          currency: paymentConfig.currency,
          upiId: paymentConfig.upiId || '',
          upiPayeeName: paymentConfig.upiPayeeName,
          paymentReferencePrefix: paymentConfig.paymentReferencePrefix,
        },
      });
      console.log('[Billing] Seeded default PlatformBillingSetting');
    } else if (existing.upiId === 'yourupi@bank' || existing.upiId.toLowerCase().includes('placeholder')) {
      // Clean up legacy placeholder from DB if present
      await directPrisma.platformBillingSetting.update({
        where: { id: existing.id },
        data: {
          upiId: paymentConfig.upiId || '',
          upiPayeeName: paymentConfig.upiPayeeName,
        },
      });
      console.log('[Billing] Cleaned legacy placeholder from PlatformBillingSetting in database');
    }
  } catch (error) {
    console.error('[Billing] Failed to seed PlatformBillingSetting:', error);
  } finally {
    await directPrisma.$disconnect();
  }
};
