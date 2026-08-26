import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentConfig } from './paymentConfig';

test('paymentConfig returns unconfigured when SEEAKK_UPI_ID is empty or unset', () => {
  const originalUpi = process.env.SEEAKK_UPI_ID;
  const originalPayee = process.env.SEEAKK_UPI_PAYEE_NAME;
  try {
    delete process.env.SEEAKK_UPI_ID;
    delete process.env.SEEAKK_UPI_PAYEE_NAME;

    const config = getPaymentConfig();
    assert.equal(config.isConfigured, false);
    assert.equal(config.upiId, null);
    assert.equal(config.upiPayeeName, 'SEEAKK');
    assert.equal(config.pricePerUserPerMonth, 499);
    assert.equal(config.currency, 'INR');
  } finally {
    process.env.SEEAKK_UPI_ID = originalUpi;
    process.env.SEEAKK_UPI_PAYEE_NAME = originalPayee;
  }
});

test('paymentConfig rejects placeholder yourupi@bank as unconfigured', () => {
  const originalUpi = process.env.SEEAKK_UPI_ID;
  try {
    process.env.SEEAKK_UPI_ID = 'yourupi@bank';

    const config = getPaymentConfig();
    assert.equal(config.isConfigured, false);
    assert.equal(config.upiId, null);
  } finally {
    process.env.SEEAKK_UPI_ID = originalUpi;
  }
});

test('paymentConfig parses valid trimmed UPI ID and payee name from ENV', () => {
  const originalUpi = process.env.SEEAKK_UPI_ID;
  const originalPayee = process.env.SEEAKK_UPI_PAYEE_NAME;
  try {
    process.env.SEEAKK_UPI_ID = '  business@okaxis  ';
    process.env.SEEAKK_UPI_PAYEE_NAME = '  SEEAKK TECH  ';

    const config = getPaymentConfig();
    assert.equal(config.isConfigured, true);
    assert.equal(config.upiId, 'business@okaxis');
    assert.equal(config.upiPayeeName, 'SEEAKK TECH');
    assert.equal(config.pricePerUserPerMonth, 499);
    assert.equal(config.currency, 'INR');
  } finally {
    process.env.SEEAKK_UPI_ID = originalUpi;
    process.env.SEEAKK_UPI_PAYEE_NAME = originalPayee;
  }
});
