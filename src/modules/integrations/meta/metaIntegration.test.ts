import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { handleWebhookVerification, parseAndVerifyMetaSignedRequest } from './metaIntegration.service';

describe('Meta Lead Ads Integration Unit Tests', () => {
  it('should verify webhook challenge correctly when verify token matches', () => {
    const mode = 'subscribe';
    const token = process.env.META_WEBHOOK_VERIFY_TOKEN || 'seeakk-meta-verify-token';
    const challenge = '123456789';

    const result = handleWebhookVerification(mode, token, challenge);
    assert.equal(result, challenge);
  });

  it('should throw error when webhook verify token is invalid', () => {
    assert.throws(() => {
      handleWebhookVerification('subscribe', 'wrong-token-invalid-xyz', '123456789');
    }, /verify_token mismatch/);
  });

  it('should parse and verify HMAC SHA256 signed request from Meta', () => {
    const appSecret = process.env.META_APP_SECRET || 'seeakk-meta-secret';
    const payloadObj = {
      user_id: 'meta_user_12345',
      algorithm: 'HMAC-SHA256',
      issued_at: Math.floor(Date.now() / 1000),
    };

    const payloadStr = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const hmacSig = crypto.createHmac('sha256', appSecret).update(payloadStr).digest();
    const encodedSig = Buffer.from(hmacSig).toString('base64url');
    const signedRequest = `${encodedSig}.${payloadStr}`;

    const verified = parseAndVerifyMetaSignedRequest(signedRequest);
    assert.equal(verified.userId, 'meta_user_12345');
    assert.equal(verified.algorithm, 'HMAC-SHA256');
  });

  it('should reject invalid signed request signature', () => {
    const payloadObj = {
      user_id: 'meta_user_12345',
      algorithm: 'HMAC-SHA256',
      issued_at: Math.floor(Date.now() / 1000),
    };

    const payloadStr = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const signedRequest = `invalid_signature.${payloadStr}`;

    assert.throws(() => {
      parseAndVerifyMetaSignedRequest(signedRequest);
    });
  });
});
