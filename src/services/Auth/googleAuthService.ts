import { OAuth2Client } from 'google-auth-library';

let cachedClient: OAuth2Client | null = null;
let cachedAudience: string | null = null;

const getGoogleClient = (): { client: OAuth2Client; audience: string } => {
  const audience = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!audience) {
    const err: any = new Error('GOOGLE_CLIENT_ID is not configured on backend');
    err.statusCode = 503;
    throw err;
  }

  if (!cachedClient || cachedAudience !== audience) {
    cachedClient = new OAuth2Client(audience);
    cachedAudience = audience;
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
