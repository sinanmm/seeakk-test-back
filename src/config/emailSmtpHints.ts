import { getSmtpConfig } from './email.config';

/**
 * Maps common SMTP errors to operator-facing hints (no secrets).
 */
export const buildSmtpAuthFailureHint = (error: unknown): string => {
  const err = error as { code?: string; message?: string; response?: string };
  const code = String(err?.code || '');
  const msg = `${err?.message || ''} ${err?.response || ''}`.toLowerCase();

  if (
    msg.includes('gmail smtp is not supported for this render deployment') ||
    msg.includes('set resend_api_key') ||
    msg.includes('gmail smtp timed out') ||
    msg.includes('connection timeout') ||
    msg.includes('enetunreach') ||
    code === 'ETIMEDOUT' ||
    code === 'ENETUNREACH'
  ) {
    return [
      'SMTP network connection failed from this host.',
      'On Render, outbound SMTP to Gmail (465/587) can be blocked or unroutable even with correct credentials.',
      'Production fix: configure RESEND_API_KEY and set EMAIL_FROM to a verified Resend sender/domain so invites use HTTPS instead of SMTP.',
      'Keep Gmail SMTP only for local development or a server/network that allows outbound SMTP.',
    ].join(' ');
  }

  if (code !== 'EAUTH' && !msg.includes('badcredentials') && !msg.includes('5.7.8') && !msg.includes('invalid login')) {
    return 'Check EMAIL_HOST / EMAIL_PORT / TLS and provider status.';
  }

  const { service, host, user, gmailStyleAuth } = getSmtpConfig();
  const looksLikeGmail =
    gmailStyleAuth ||
    user.toLowerCase().includes('@gmail.com') ||
    user.toLowerCase().includes('@googlemail.com');

  if (looksLikeGmail) {
    return [
      'Gmail rejected the username/password (EAUTH / 535).',
      'Fix: use a Google Account "App Password" (16 chars) as EMAIL_PASS, not your normal Gmail password.',
      'Enable 2-Step Verification on the Google account, then create an App Password: Google Account → Security → App passwords.',
      'EMAIL_USER must be the full Gmail address (e.g. you@gmail.com).',
      'Workspace accounts: admin may block SMTP; use App Password or a relay (SendGrid/Mailgun) if required.',
      'Docs: https://support.google.com/mail/?p=BadCredentials',
    ].join(' ');
  }

  return [
    'SMTP authentication failed (EAUTH).',
    'Verify SMTP_USER / SMTP_PASS (or EMAIL_USER / EMAIL_PASS) match your provider.',
    'If using a custom host, confirm EMAIL_PORT and EMAIL_SECURE (465=true, 587=false).',
  ].join(' ');
};
