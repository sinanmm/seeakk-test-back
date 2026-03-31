import { OAuth2Client } from 'google-auth-library';

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();

if (!googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID is required for Google authentication');
}

const client = new OAuth2Client(googleClientId);

const verifyGoogleToken = async (token: string) => {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: googleClientId,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Google token payload is empty');
  }

  return payload;
};

export default verifyGoogleToken;
