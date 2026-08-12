import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const getSecretKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || 'seeakk-default-encryption-secret-key-32-chars!!';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypts sensitive text (e.g. Meta access tokens) using AES-256-GCM.
 */
export const encryptToken = (text: string): string => {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getSecretKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypts encrypted text using AES-256-GCM.
 */
export const decryptToken = (encryptedText: string): string => {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    // Fallback if plain text was stored
    return encryptedText;
  }
  
  const [ivHex, authTagHex, encryptedDataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = getSecretKey();
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
