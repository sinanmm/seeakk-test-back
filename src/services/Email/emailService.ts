import dns from 'dns';
import nodemailer, { Transporter } from 'nodemailer';
import { getSmtpConfig, isEmailConfigured } from '../../config/email.config';
import { getPublicBackendUrl, getPublicFrontendUrl } from '../../config/publicUrls';
import logger from '../../utils/logger';
import { sendEmailViaResend, verifyResendApiKey } from './resendTransport';

let transporter: Transporter | null = null;

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

/**
 * Creates a production-hardened Nodemailer transporter.
 * Optimized for port 465 (SSL) to prevent ENETUNREACH issues on cloud providers.
 */
const createTransporter = (): Transporter => {
  const { user, pass, host, port, secure } = getSmtpConfig();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Render often has no IPv6 egress route; force Gmail SMTP to IPv4.
    family: 4,
    lookup: lookupIpv4,
    dnsTimeout: 30000,
    // Enable pooling for better connection re-use on cloud platforms
    pool: true,
    connectionTimeout: 30000, // Increase to 30s for slow handshakes on Render
    greetingTimeout: 30000,
    socketTimeout: 45000,
    tls: {
      rejectUnauthorized: false,
      servername: host
    }
  } as any);
};

const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
};

const sendWithRetry = async (mailOptions: any, retries = 2): Promise<void> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await getTransporter().sendMail(mailOptions);
      return;
    } catch (error: any) {
      if (['EAUTH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNRESET'].includes(error?.code)) {
        transporter = null;
      }
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
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

  try {
    console.log(`[EmailService] Verifying connection to ${cfg.host}:${cfg.port}...`);
    await getTransporter().verify();
    console.log('✅ [EmailService] SMTP connection verified successfully');
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
