import dns from 'dns';
import nodemailer, { Transporter } from 'nodemailer';
import { getSmtpConfig, isEmailConfigured } from '../../config/email.config';
import { getPublicBackendUrl, getPublicFrontendUrl } from '../../config/publicUrls';
import logger from '../../utils/logger';
import { sendEmailViaResend, verifyResendApiKey } from './resendTransport';

type SmtpEndpoint = {
  host: string;
  port: number;
  secure: boolean;
  label: string;
};

type ResolvedSmtpEndpoint = SmtpEndpoint & {
  connectionHost: string;
};

const transporterCache = new Map<string, Transporter>();

dns.setDefaultResultOrder?.('ipv4first');

const lookupIpv4 = (hostname: string, options: unknown, callback?: unknown) => {
  const cb = typeof options === 'function' ? options : callback;
  const lookupOptions = typeof options === 'object' && options !== null ? options : {};

  return dns.lookup(
    hostname,
    {
      ...lookupOptions,
      family: 4,
      all: false,
    },
    cb as any,
  );
};

const getTimeoutMs = (key: string, fallback: number): number => {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getSmtpEndpoints = (): SmtpEndpoint[] => {
  const cfg = getSmtpConfig();
  const endpoints: SmtpEndpoint[] = [
    {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      label: 'primary',
    },
  ];

  // Render can time out on implicit TLS/465 even when STARTTLS/587 works.
  // For Gmail, try STARTTLS as a second route before declaring delivery unavailable.
  if (cfg.gmailStyleAuth && cfg.port !== 587) {
    endpoints.push({
      host: cfg.host || 'smtp.gmail.com',
      port: 587,
      secure: false,
      label: 'gmail-starttls',
    });
  }

  return endpoints;
};

const getTransportKey = (endpoint: SmtpEndpoint): string =>
  `${endpoint.host}:${endpoint.port}:${endpoint.secure ? 'secure' : 'starttls'}`;

const deleteTransportersForEndpoint = (endpoint: SmtpEndpoint): void => {
  const prefix = `${getTransportKey(endpoint)}:`;
  for (const key of transporterCache.keys()) {
    if (key.startsWith(prefix)) {
      transporterCache.delete(key);
    }
  }
};

const isIpv4Address = (value: string): boolean => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);

const resolveEndpointIpv4 = async (endpoint: SmtpEndpoint): Promise<ResolvedSmtpEndpoint> => {
  if (isIpv4Address(endpoint.host)) {
    return { ...endpoint, connectionHost: endpoint.host };
  }

  try {
    const addresses = await dns.promises.resolve4(endpoint.host);
    const connectionHost = addresses[0];
    if (connectionHost) {
      return { ...endpoint, connectionHost };
    }
  } catch (error: any) {
    logger.warn('SMTP IPv4 resolve4 failed; falling back to dns.lookup family 4', {
      host: endpoint.host,
      label: endpoint.label,
      error: error?.message || String(error),
    });
  }

  const lookupResult = await dns.promises.lookup(endpoint.host, { family: 4 });
  return { ...endpoint, connectionHost: lookupResult.address };
};

/**
 * Creates a production-hardened Nodemailer transporter.
 * Uses IPv4-only lookup and supports Gmail's STARTTLS fallback for cloud hosts.
 */
const createTransporter = (endpoint: ResolvedSmtpEndpoint): Transporter => {
  const { user, pass } = getSmtpConfig();
  const connectionTimeout = getTimeoutMs('EMAIL_CONNECTION_TIMEOUT_MS', 15000);
  const greetingTimeout = getTimeoutMs('EMAIL_GREETING_TIMEOUT_MS', 15000);
  const socketTimeout = getTimeoutMs('EMAIL_SOCKET_TIMEOUT_MS', 30000);

  return nodemailer.createTransport({
    host: endpoint.connectionHost,
    port: endpoint.port,
    secure: endpoint.secure,
    auth: { user, pass },
    // Render often has no IPv6 egress route; force Gmail SMTP to IPv4.
    family: 4,
    lookup: lookupIpv4,
    dnsTimeout: 30000,
    requireTLS: !endpoint.secure,
    // Enable pooling for better connection re-use on cloud platforms
    pool: true,
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    tls: {
      rejectUnauthorized: false,
      servername: endpoint.host
    }
  } as any);
};

const getTransporter = async (endpoint: SmtpEndpoint): Promise<Transporter> => {
  const resolvedEndpoint = await resolveEndpointIpv4(endpoint);
  const key = `${getTransportKey(endpoint)}:${resolvedEndpoint.connectionHost}`;
  let transporter = transporterCache.get(key);
  if (!transporter) {
    transporter = createTransporter(resolvedEndpoint);
    transporterCache.set(key, transporter);
  }
  return transporter;
};

const isRecoverableTransportError = (error: any): boolean =>
  ['EAUTH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNRESET'].includes(error?.code) ||
  String(error?.message || '').toLowerCase().includes('connection timeout');

const isTransportTimeout = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'ETIMEDOUT' || message.includes('connection timeout') || message.includes('timeout');
};

const isRenderRuntime = (): boolean => String(process.env.RENDER || '').toLowerCase() === 'true';

const buildRenderSmtpBlockedError = (): Error =>
  new Error(
    'Gmail SMTP is not supported for this Render deployment. Set RESEND_API_KEY and EMAIL_FROM with a verified Resend sender/domain so invite emails are sent over HTTPS.',
  );

const assertSmtpAllowedForRuntime = (): void => {
  const cfg = getSmtpConfig();
  if (isRenderRuntime() && cfg.gmailStyleAuth && !cfg.resendApiKey) {
    throw buildRenderSmtpBlockedError();
  }
};

const enrichSmtpError = (error: any): Error => {
  const cfg = getSmtpConfig();
  if (cfg.gmailStyleAuth && !cfg.resendApiKey && isTransportTimeout(error)) {
    return new Error(
      'Gmail SMTP timed out from this hosting environment. Render commonly blocks or cannot route outbound SMTP ports. Configure RESEND_API_KEY and a verified EMAIL_FROM domain to send invites over HTTPS instead of SMTP.',
    );
  }

  return error instanceof Error ? error : new Error(String(error || 'Email delivery failed.'));
};

const sendWithRetry = async (mailOptions: any, retries = 2): Promise<void> => {
  assertSmtpAllowedForRuntime();

  let lastError: any = null;

  for (const endpoint of getSmtpEndpoints()) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const transporter = await getTransporter(endpoint);
        await transporter.sendMail(mailOptions);
        return;
      } catch (error: any) {
        lastError = error;
        if (isRecoverableTransportError(error)) {
          deleteTransportersForEndpoint(endpoint);
        }
        if (attempt === retries) break;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw enrichSmtpError(lastError);
};

export const verifyEmailTransport = async (): Promise<void> => {
  if (!isEmailConfigured()) {
    throw new Error('Email service not configured.');
  }

  const cfg = getSmtpConfig();
  if (cfg.resendApiKey) {
    await verifyResendApiKey(cfg.resendApiKey);
    return;
  }
  assertSmtpAllowedForRuntime();

  try {
    let lastError: any = null;
    for (const endpoint of getSmtpEndpoints()) {
      try {
        console.log(`[EmailService] Verifying connection to ${endpoint.host}:${endpoint.port} (${endpoint.label})...`);
        const transporter = await getTransporter(endpoint);
        await transporter.verify();
        console.log(`✅ [EmailService] SMTP connection verified successfully via ${endpoint.host}:${endpoint.port}`);
        return;
      } catch (error: any) {
        lastError = error;
        if (isRecoverableTransportError(error)) {
          deleteTransportersForEndpoint(endpoint);
        }
        logger.warn('SMTP endpoint verification failed', {
          host: endpoint.host,
          port: endpoint.port,
          secure: endpoint.secure,
          label: endpoint.label,
          error: error?.message || String(error),
        });
      }
    }

    throw enrichSmtpError(lastError);
  } catch (error: any) {
    console.error('❌ [EmailService] Verification failed:', error.message);
    throw error;
  }
};

export const logEmailConfigSummary = (): void => {
  const cfg = getSmtpConfig();
  logger.info('Email configuration summary', {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    configured: cfg.configured
  });
};

const sendOrLogEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  if (!isEmailConfigured()) {
    logger.warn('Email not configured - skipping');
    return false;
  }

  try {
    const config = getSmtpConfig();
    if (config.resendApiKey) {
      await sendEmailViaResend({ apiKey: config.resendApiKey, from: config.from, to, subject, html });
    } else {
      await sendWithRetry({ from: config.from, to, subject, html });
    }
    return true;
  } catch (error: any) {
    logger.error('Email delivery failed', { error: error.message });
    return false;
  }
};

const buildEmailConfigError = (): Error => {
  const config = getSmtpConfig();
  if (config.resendApiKey) {
    return new Error('Resend email delivery is configured, but the API request failed.');
  }

  const missing = [
    !config.host ? 'EMAIL_HOST/SMTP_HOST' : null,
    !config.user ? 'EMAIL_USER/SMTP_USER' : null,
    !config.pass ? 'EMAIL_PASS/SMTP_PASS' : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    return new Error(`Email service not configured. Missing: ${missing.join(', ')}.`);
  }

  return new Error('Email service not configured.');
};

const sendRequiredEmail = async (to: string, subject: string, html: string): Promise<void> => {
  if (!isEmailConfigured()) {
    throw buildEmailConfigError();
  }

  const config = getSmtpConfig();
  if (config.resendApiKey) {
    await sendEmailViaResend({ apiKey: config.resendApiKey, from: config.from, to, subject, html });
    return;
  }

  await sendWithRetry({ from: config.from, to, subject, html });
};

// --- Exported Application Methods ---

export const sendVerificationEmail = async (email: string, token: string): Promise<boolean> => {
  const backendUrl = getPublicBackendUrl();
  const verifyLink = `${backendUrl}/api/auth/verify-email?token=${token}`;
  return sendOrLogEmail(
    email,
    'Verify your Seeakk Account',
    `<h2>Welcome!</h2><p>Verify your email here:</p><a href="${verifyLink}">Verify Email</a>`
  );
};

export const sendPasswordResetEmail = async (email: string, name: string | null | undefined, token: string): Promise<boolean> => {
  const backendUrl = getPublicBackendUrl();
  const resetLink = `${backendUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
  return sendOrLogEmail(
    email,
    'Reset your Seeakk password',
    `<h2>Reset Password</h2><p>Click below to reset:</p><a href="${resetLink}">Reset Password</a>`
  );
};

export const sendInvitationEmail = async (
  email: string,
  input: {
    recipientName: string;
    workspaceName: string;
    inviterName?: string | null;
    inviteToken: string;
    expiresAt: Date;
  },
): Promise<boolean> => {
  const appUrl = getPublicFrontendUrl();
  if (!appUrl) {
    throw new Error('FRONTEND_URL or ALLOWED_ORIGINS is required to build invite links.');
  }

  const inviteLink = `${appUrl}/invite/accept?token=${encodeURIComponent(input.inviteToken)}`;
  await sendRequiredEmail(
    email,
    `You're invited to join ${input.workspaceName} on Seeakk`,
    `<h2>Invitation</h2><p>You've been invited to ${input.workspaceName}.</p><a href="${inviteLink}">Join Now</a>`
  );
  return true;
};

export type FollowUpEmailDispatch = 'sent' | 'skipped_no_smtp' | 'mock_dev';

export const sendFollowUpReminderEmail = async (
  email: string,
  input: {
    userDisplayName: string;
    leadName: string;
    scheduledAt: Date;
    description?: string;
    type?: string;
  },
): Promise<FollowUpEmailDispatch> => {
  const appUrl = getPublicFrontendUrl();
  const deepLink = `${appUrl}/calendar/today`;
  const sent = await sendOrLogEmail(
    email,
    `Follow-up reminder: ${input.leadName}`,
    `<h2>Reminder</h2><p>Follow-up for ${input.leadName} at ${input.scheduledAt.toLocaleString()}</p><a href="${deepLink}">View Task</a>`
  );
  return sent ? 'sent' : 'skipped_no_smtp';
};

export const isEmailServiceConfigured = () => isEmailConfigured();
