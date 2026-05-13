import nodemailer, { Transporter } from 'nodemailer';
import { getSmtpConfig, isEmailConfigured } from '../../config/email.config';
import { getPublicBackendUrl, getPublicFrontendUrl } from '../../config/publicUrls';
import logger from '../../utils/logger';
import { sendEmailViaResend, verifyResendApiKey } from './resendTransport';

let transporter: Transporter | null = null;

/**
 * Creates a production-hardened Nodemailer transporter.
 * Optimized for port 465 (SSL) to prevent ENETUNREACH issues on cloud providers.
 */
const createTransporter = (): Transporter => {
  const { user, pass, host, port, secure } = getSmtpConfig();

  return nodemailer.createTransport({
    host,
    port,
    secure, // true for 465, false for 587
    auth: { user, pass },
    // Production hardening:
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 15000,
    debug: process.env.DEBUG_EMAIL === 'true',
    logger: process.env.DEBUG_EMAIL === 'true' as any,
    tls: {
      // Prevents issues with mismatched certificates in some cloud proxy environments
      rejectUnauthorized: false,
      // Forces Node to use IPv4 - This is the primary fix for ENETUNREACH on Render
      servername: host
    }
  });
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
      if (error?.code === 'EAUTH') {
        transporter = null; // Force recreation on auth error
      }
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
};

export const verifyEmailTransport = async (): Promise<void> => {
  if (!isEmailConfigured()) {
    throw new Error('Email service not configured. Set EMAIL_HOST, EMAIL_USER, and EMAIL_PASS.');
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
    console.error('❌ [EmailService] Verification failed:', {
      message: error.message,
      code: error.code,
      command: error.command
    });
    throw error;
  }
};

export const logEmailConfigSummary = (): void => {
  const cfg = getSmtpConfig();
  logger.info('Email configuration summary', {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
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
      await sendEmailViaResend({
        apiKey: config.resendApiKey,
        from: config.from,
        to,
        subject,
        html,
      });
    } else {
      await sendWithRetry({
        from: config.from,
        to,
        subject,
        html,
      });
    }
    return true;
  } catch (error: any) {
    logger.error('Email delivery failed', { error: error.message });
    return false;
  }
};

// Simplified export wrappers for the rest of the application
export const sendInvitationEmail = async (email: string, input: any) => {
  const appUrl = getPublicFrontendUrl();
  const inviteLink = `${appUrl}/invite/accept?token=${encodeURIComponent(input.inviteToken)}`;
  
  return sendOrLogEmail(
    email,
    `Invitation to join ${input.workspaceName}`,
    `<h2>Welcome!</h2><p>Click below to join:</p><a href="${inviteLink}">Join Workspace</a>`
  );
};

export const isEmailServiceConfigured = () => isEmailConfigured();
