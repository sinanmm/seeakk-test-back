import crypto from 'crypto';

const DEFAULT_TOKEN_BYTES = 32;

export const generateInviteToken = (bytes = DEFAULT_TOKEN_BYTES): string =>
  crypto.randomBytes(bytes).toString('base64url');

export const hashInviteToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

export const createInviteTokenPair = (): { rawToken: string; tokenHash: string } => {
  const rawToken = generateInviteToken();
  return {
    rawToken,
    tokenHash: hashInviteToken(rawToken),
  };
};
