import axios, { isAxiosError } from 'axios';

const RESEND_API_BASE = 'https://api.resend.com';

const pickResendErrorMessage = (error: unknown): string => {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message && typeof data.message === 'string') {
      return data.message;
    }
    if (error.response?.status) {
      return `Resend HTTP ${error.response.status}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
};

/**
 * Confirms the API key is accepted (no secrets logged).
 */
export const verifyResendApiKey = async (apiKey: string): Promise<void> => {
  try {
    await axios.get(`${RESEND_API_BASE}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
  } catch (error: unknown) {
    if (isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
      throw new Error('Resend API key rejected (401/403). Check RESEND_API_KEY.');
    }
    throw new Error(pickResendErrorMessage(error));
  }
};

export const sendEmailViaResend = async (opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> => {
  try {
    await axios.post(
      `${RESEND_API_BASE}/emails`,
      {
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      },
      {
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
  } catch (error: unknown) {
    throw new Error(pickResendErrorMessage(error));
  }
};
