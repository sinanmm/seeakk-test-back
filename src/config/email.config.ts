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

const isGmailProvider = (service: string, host: string): boolean =>
  service.toLowerCase() === 'gmail' || host.toLowerCase().includes('gmail.com');

export type SmtpConfig = {
  service: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  configured: boolean;
  transportMode: 'custom_host' | 'well_known_service';
};

export const getSmtpConfig = (): SmtpConfig => {
  const service = readEnv('EMAIL_SERVICE', 'SMTP_SERVICE');
  const host = readEnv('EMAIL_HOST', 'SMTP_HOST');
  const portRaw = readEnv('EMAIL_PORT', 'SMTP_PORT');
  const port = Number(portRaw || 0);
  const secureRaw = readEnv('EMAIL_SECURE', 'SMTP_SECURE').toLowerCase();
  const user = readEnv('EMAIL_USER', 'SMTP_USER');
  const rawPass = readEnv('EMAIL_PASS', 'SMTP_PASS', 'EMAIL_PASSWORD', 'SMTP_PASSWORD');
  const pass = isGmailProvider(service || 'gmail', host) ? rawPass.replace(/\s+/g, '') : rawPass;
  const secure = secureRaw ? secureRaw === 'true' : port === 465;
  const from = readEnv('EMAIL_FROM', 'SMTP_FROM') || user || 'no-reply@seeakk.com';
  const hasHostPort = Boolean(host && Number.isFinite(port) && port > 0);
  const transportMode: SmtpConfig['transportMode'] = hasHostPort ? 'custom_host' : 'well_known_service';

  const config = {
    service,
    host,
    port,
    secure,
    user,
    pass,
    from,
    configured: Boolean(user && pass),
    transportMode,
  };

  if (process.env.DEBUG_EMAIL === 'true') {
    console.log('[EmailConfig] Resolved configuration:', {
      ...config,
      pass: config.pass ? '***REDACTED***' : '(empty)'
    });
  }

  return config;
};

export const isEmailConfigured = (): boolean => getSmtpConfig().configured;

/** Safe summary for startup logs (no credentials). */
export const describeEmailConfigForLogging = (): Record<string, string | boolean> => {
  const c = getSmtpConfig();
  const hasExplicitFrom = Boolean(readEnv('EMAIL_FROM', 'SMTP_FROM'));
  return {
    configured: c.configured,
    transportMode: c.transportMode,
    hasExplicitFrom,
    hasCustomSmtpHost: Boolean(c.host),
  };
};
