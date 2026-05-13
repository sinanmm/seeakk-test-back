/**
 * SMTP / transactional email configuration (no secrets logged from here).
 */

const readEnv = (...keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
};

/** Remove accidental wrapping quotes / BOM from pasted .env values */
const stripQuotes = (value: string): string =>
  value.replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').trim();

/**
 * Must match `createTransporter` in emailService.ts: when true, nodemailer talks to Gmail SMTP
 * and App Passwords should be normalized (spaces removed).
 */
const usesGmailSmtpTransport = (service: string, host: string, port: number): boolean => {
  const hasHostPort = Boolean(host && Number.isFinite(port) && port > 0);
  if (hasHostPort) {
    return host.toLowerCase().includes('gmail.com');
  }
  return (service || 'gmail').toLowerCase() === 'gmail';
};

export type SmtpConfig = {
  service: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** True when EMAIL_USER + EMAIL_PASS (or SMTP_*) are set. */
  smtpConfigured: boolean;
  /** Resend transactional API (optional; preferred over SMTP when set). */
  resendApiKey: string;
  /** True when Resend API key or SMTP credentials are present. */
  configured: boolean;
  /** How outbound mail is sent when `configured` is true. */
  outboundTransport: 'resend' | 'smtp';
  transportMode: 'custom_host' | 'well_known_service';
  /** True when outbound SMTP is Gmail (App Password rules apply). */
  gmailStyleAuth: boolean;
};

export const getSmtpConfig = (): SmtpConfig => {
  const service = readEnv('EMAIL_SERVICE', 'SMTP_SERVICE');
  const host = readEnv('EMAIL_HOST', 'SMTP_HOST');
  const portRaw = readEnv('EMAIL_PORT', 'SMTP_PORT');
  const port = Number(portRaw || 0);
  const secureRaw = readEnv('EMAIL_SECURE', 'SMTP_SECURE').toLowerCase();
  const user = stripQuotes(readEnv('EMAIL_USER', 'SMTP_USER'));
  const rawPass = stripQuotes(readEnv('EMAIL_PASS', 'SMTP_PASS', 'EMAIL_PASSWORD', 'SMTP_PASSWORD'));
  const gmailStyleAuth = usesGmailSmtpTransport(service, host, port);
  const pass = rawPass.replace(/\s+/g, '');
  const secure = secureRaw ? secureRaw === 'true' : port === 465;
  const from = readEnv('EMAIL_FROM', 'SMTP_FROM') || user || 'no-reply@seeakk.com';
  const hasHostPort = Boolean(host && Number.isFinite(port) && port > 0);
  const transportMode: SmtpConfig['transportMode'] = hasHostPort ? 'custom_host' : 'well_known_service';
  const resendApiKey = stripQuotes(readEnv('RESEND_API_KEY'));
  const smtpConfigured = Boolean(user && pass);
  const configured = smtpConfigured || Boolean(resendApiKey);
  const outboundTransport: SmtpConfig['outboundTransport'] = resendApiKey ? 'resend' : 'smtp';

  const config = {
    service,
    host,
    port,
    secure,
    user,
    pass,
    from,
    smtpConfigured,
    resendApiKey,
    configured,
    outboundTransport,
    transportMode,
    gmailStyleAuth,
  };

  if (process.env.DEBUG_EMAIL === 'true') {
    console.log('[EmailConfig] Resolved configuration:', {
      ...config,
      pass: config.pass ? '***REDACTED***' : '(empty)',
      resendApiKey: config.resendApiKey ? '***REDACTED***' : '(empty)',
    });
  }

  return config;
};

export const isEmailConfigured = (): boolean => getSmtpConfig().configured;

/** Safe summary for startup logs (no credentials). */
export const describeEmailConfigForLogging = (): Record<string, string | boolean | number> => {
  const c = getSmtpConfig();
  const hasExplicitFrom = Boolean(readEnv('EMAIL_FROM', 'SMTP_FROM'));
  const gmailAppPasswordLength = c.gmailStyleAuth && c.smtpConfigured ? c.pass.length : 0;
  return {
    configured: c.configured,
    outboundTransport: c.outboundTransport,
    smtpConfigured: c.smtpConfigured,
    resendConfigured: Boolean(c.resendApiKey),
    transportMode: c.transportMode,
    hasExplicitFrom,
    hasCustomSmtpHost: Boolean(c.host),
    smtpUserLooksLikeEmail: c.user.includes('@'),
    gmailStyleAuth: c.gmailStyleAuth,
    gmailAppPasswordCharCount: gmailAppPasswordLength,
    gmailAppPasswordLengthLooksValid:
      !c.gmailStyleAuth || !c.smtpConfigured || c.pass.length === 16,
  };
};
