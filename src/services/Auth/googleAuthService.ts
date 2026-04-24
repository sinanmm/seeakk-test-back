import { OAuth2Client } from 'google-auth-library';

let cachedClient: OAuth2Client | null = null;
let cachedAudienceKey: string | null = null;

const parseGoogleClientIds = (): string[] => {
  const raw = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const getGoogleClient = (): { client: OAuth2Client; audience: string | string[] } => {
  const clientIds = parseGoogleClientIds();
  if (clientIds.length === 0) {
    const err: any = new Error('GOOGLE_CLIENT_ID is not configured on backend');
    err.statusCode = 503;
    throw err;
  }

  const audience: string | string[] = clientIds.length === 1 ? clientIds[0] : clientIds;
  const cacheKey = clientIds.join('|');

  if (!cachedClient || cachedAudienceKey !== cacheKey) {
    cachedClient = new OAuth2Client(clientIds[0]);
    cachedAudienceKey = cacheKey;
  }

  return { client: cachedClient, audience };
};

const verifyGoogleToken = async (token: string) => {
  const { client, audience } = getGoogleClient();
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Google token payload is empty');
  }

  return payload;
};

export default verifyGoogleToken;
