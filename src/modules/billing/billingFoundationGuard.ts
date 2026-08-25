import { PrismaClient } from '@prisma/client';

const directPrisma = new PrismaClient();

export const ensureBillingFoundationSeeded = async () => {
  try {
    const existing = await directPrisma.platformBillingSetting.findFirst();
    if (!existing) {
      await directPrisma.platformBillingSetting.create({
        data: {
          pricePerUserPerMonth: 499,
          currency: 'INR',
          upiId: 'yourupi@bank',
          upiPayeeName: 'SEEAKK',
          paymentReferencePrefix: 'SEEAKK-PAY',
        },
      });
      console.log('[Billing] Seeded default PlatformBillingSetting');
    }
  } catch (error) {
    console.error('[Billing] Failed to seed PlatformBillingSetting:', error);
  } finally {
    await directPrisma.$disconnect();
  }
};
