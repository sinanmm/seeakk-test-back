/**
 * SMTP / Transactional email configuration for Production.
 * Optimized for Render, AWS, and other cloud providers.
 */

const readEnv = (key: string, fallback: string = ''): string => {
  return (process.env[key] || fallback).trim();
};

/** Remove accidental wrapping quotes / BOM from pasted .env values */
const stripQuotes = (value: string): string =>
  value.replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').trim();

export type SmtpConfig = {
  service: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  configured: boolean;
  /** Resend transactional API (optional fallback) */
  resendApiKey: string;
  /** Used by SMTP hints to identify Gmail-specific rules */
  gmailStyleAuth: boolean;
};

export const getSmtpConfig = (): SmtpConfig => {
  const service = readEnv('EMAIL_SERVICE');
  // Production Requirement: Explicit Host/Port/Secure
  const host = stripQuotes(readEnv('EMAIL_HOST', 'smtp.gmail.com'));
  const port = Number(readEnv('EMAIL_PORT', '465'));
  
  // EMAIL_SECURE should be true for port 465
  const secureRaw = readEnv('EMAIL_SECURE', 'true').toLowerCase();
  const secure = secureRaw === 'true' || port === 465;

  const user = stripQuotes(readEnv('EMAIL_USER'));
  const rawPass = stripQuotes(readEnv('EMAIL_PASS'));
  
  // Normalize Gmail App Passwords (remove spaces) if it's a Gmail host
  const isGmail = host.toLowerCase().includes('gmail.com') || service.toLowerCase() === 'gmail';
  const pass = isGmail ? rawPass.replace(/\s+/g, '') : rawPass;

  const from = stripQuotes(readEnv('EMAIL_FROM')) || user || 'no-reply@seeakk.com';
  const resendApiKey = stripQuotes(readEnv('RESEND_API_KEY'));

  const smtpConfigured = Boolean(host && user && pass);
  const configured = smtpConfigured || Boolean(resendApiKey);

  const config = {
    service,
    host,
    port,
    secure,
    user,
    pass,
    from,
    configured,
    resendApiKey,
    gmailStyleAuth: isGmail
  };

  if (process.env.DEBUG_EMAIL === 'true') {
    console.log('[EmailConfig] Production SMTP Resolver:', {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      from: config.from,
      hasPass: !!config.pass,
      isGmail
    });
  }

  return config;
};

export const isEmailConfigured = (): boolean => getSmtpConfig().configured;
