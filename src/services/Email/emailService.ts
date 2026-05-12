import nodemailer, { Transporter } from 'nodemailer';
import { describeEmailConfigForLogging, getSmtpConfig, isEmailConfigured } from '../../config/email.config';
import { getPublicBackendUrl, getPublicFrontendUrl } from '../../config/publicUrls';
import logger from '../../utils/logger';

const isProduction = process.env.NODE_ENV === 'production';

export const isEmailServiceConfigured = (): boolean => isEmailConfigured();

let transporter: Transporter | null = null;

const createTransporter = (): Transporter => {
  const { user, pass, service, host, port, secure } = getSmtpConfig();

  if (host && Number.isFinite(port) && port > 0) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }

  return nodemailer.createTransport({
    service: service || 'gmail',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
};

const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter as Transporter;
};

const sendWithRetry = async (mailOptions: Record<string, unknown>, retries: number = 2): Promise<void> => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await getTransporter().sendMail(mailOptions);
      return;
    } catch (error: any) {
      const isLastAttempt = attempt === retries;
      if (error?.code === 'EAUTH') {
        transporter = null;
      }
      if (isLastAttempt) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
};

export const verifyEmailTransport = async (): Promise<void> => {
  if (!isEmailConfigured()) {
    throw new Error('Email service is not configured. Set EMAIL_USER and EMAIL_PASS or SMTP_USER and SMTP_PASS.');
  }

  await getTransporter().verify();
};

/** Log once at module load is noisy; callers (server) should log summary after import. */
export const logEmailConfigSummary = (): void => {
  logger.info('Email configuration summary', {
    module: 'email',
    ...describeEmailConfigForLogging(),
  });
};

type SendOutcome = { sent: true } | { sent: false; reason: 'production_unconfigured' | 'dev_mock' };

const sendOrLogEmail = async (
  to: string,
  subject: string,
  html: string,
  previewLinkLabel: string,
  previewLink: string,
): Promise<SendOutcome> => {
  if (isProduction && !isEmailConfigured()) {
    logger.warn('Email service not configured; skipping outbound email', {
      to,
      subject,
      previewLinkLabel,
      previewLink,
      environment: process.env.NODE_ENV,
      module: 'email',
    });
    return { sent: false, reason: 'production_unconfigured' };
  }

  if (!isEmailConfigured()) {
    logger.warn('Email not configured — mock mode (dev)', {
      to,
      subject,
      previewLinkLabel,
      module: 'email',
    });
    console.warn('⚠️ Email not configured — using mock mode');
    console.log('Mock email:', { to, subject, link: previewLink });
    return { sent: false, reason: 'dev_mock' };
  }

  try {
    const config = getSmtpConfig();
    await sendWithRetry({
      from: config.from,
      to,
      subject,
      html,
    });
    return { sent: true };
  } catch (error: any) {
    logger.error('Email delivery failed', {
      to,
      subject,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code,
      response: error?.response,
      command: error?.command,
      environment: process.env.NODE_ENV,
      module: 'email',
    });
    throw new Error(
      `Email delivery failed for "${subject}". Check SMTP configuration and provider access.`,
    );
  }
};

/** @returns true if an SMTP message was accepted; false if skipped (mock / production without SMTP). */
export const sendVerificationEmail = async (email: string, token: string): Promise<boolean> => {
  const backendUrl = getPublicBackendUrl();
  if (!backendUrl) {
    logger.error('BACKEND_URL is not set; verification links will be invalid', { module: 'email' });
    throw new Error('Server misconfiguration: BACKEND_URL must be set for verification emails.');
  }
  const verifyLink = `${backendUrl}/api/auth/verify-email?token=${token}`;

  const outcome = await sendOrLogEmail(
    email,
    'Verify your Seeakk Account',
    `
      <h2>Welcome to Seeakk CRM!</h2>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="${verifyLink}" style="padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Verify Email</a>
      <br/><br/>
      <p>Or copy this link into your browser: <br/> ${verifyLink}</p>
      <p>This link expires in 24 hours.</p>
    `,
    'Verification Link',
    verifyLink,
  );
  return outcome.sent;
};

/** @returns true if an SMTP message was accepted; false if skipped (mock / production without SMTP). */
export const sendPasswordResetEmail = async (email: string, name: string | null | undefined, token: string): Promise<boolean> => {
  const backendUrl = getPublicBackendUrl();
  if (!backendUrl) {
    logger.error('BACKEND_URL is not set; reset links will be invalid', { module: 'email' });
    throw new Error('Server misconfiguration: BACKEND_URL must be set for password reset emails.');
  }
  const resetLink = `${backendUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
  const displayName = name?.trim() || 'there';

  const outcome = await sendOrLogEmail(
    email,
    'Reset your Seeakk password',
    `
      <h2>Password reset request</h2>
      <p>Hi ${displayName},</p>
      <p>We received a request to reset your password.</p>
      <a href="${resetLink}" style="padding: 10px 20px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Reset Password</a>
      <br/><br/>
      <p>If the button does not work, copy this link: <br/> ${resetLink}</p>
      <p>This link expires in 30 minutes.</p>
      <p>If you did not request this, ignore this email.</p>
    `,
    'Reset Link',
    resetLink,
  );
  return outcome.sent;
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
  const frontendUrl = getPublicFrontendUrl();
  const backendUrl = getPublicBackendUrl();
  if (!frontendUrl) {
    logger.error('FRONTEND_URL is not set; invitation accept link will be invalid', { module: 'email' });
    throw new Error('Server misconfiguration: FRONTEND_URL must be set for invitation emails.');
  }
  if (!backendUrl) {
    logger.error('BACKEND_URL is not set; invitation validation link will be invalid', { module: 'email' });
    throw new Error('Server misconfiguration: BACKEND_URL must be set for invitation emails.');
  }
  const inviteLink = `${frontendUrl}/invite/accept?token=${encodeURIComponent(input.inviteToken)}`;
  const fallbackValidateLink = `${backendUrl}/api/auth/invite/validate?token=${encodeURIComponent(input.inviteToken)}`;
  const displayName = input.recipientName?.trim() || email;
  const inviterName = input.inviterName?.trim() || 'your administrator';

  const outcome = await sendOrLogEmail(
    email,
    `You're invited to join ${input.workspaceName} on Seeakk`,
    `
      <h2>You're invited to Seeakk</h2>
      <p>Hi ${displayName},</p>
      <p>${inviterName} invited you to join the workspace <b>${input.workspaceName}</b>.</p>
      <p>Use the secure invitation link below to set your password and activate your account.</p>
      <a href="${inviteLink}" style="padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Accept Invitation</a>
      <br/><br/>
      <p>If the button does not work, copy this link into your browser: <br/> ${inviteLink}</p>
      <p>API validation endpoint: <br/> ${fallbackValidateLink}</p>
      <p>This invitation expires on ${input.expiresAt.toUTCString()} and can only be used once.</p>
    `,
    'Invitation Link',
    inviteLink,
  );
  return outcome.sent;
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
  if (!appUrl) {
    logger.error('FRONTEND_URL is not set; follow-up reminder deep link invalid', { module: 'email' });
    throw new Error('Server misconfiguration: FRONTEND_URL must be set for follow-up reminder emails.');
  }
  const when = input.scheduledAt.toLocaleString();
  const subject = `Follow-up reminder: ${input.leadName}`;
  const deepLink = `${appUrl}/calendar/today`;

  const outcome = await sendOrLogEmail(
    email,
    subject,
    `
      <h2>Follow-up reminder</h2>
      <p>Hi ${input.userDisplayName},</p>
      <p>You have a follow-up scheduled soon.</p>
      <ul>
        <li><b>Lead</b>: ${input.leadName}</li>
        <li><b>When</b>: ${when}</li>
        ${input.type ? `<li><b>Type</b>: ${input.type}</li>` : ''}
        ${input.description ? `<li><b>Notes</b>: ${input.description}</li>` : ''}
      </ul>
      <a href="${deepLink}" style="padding: 10px 16px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; display: inline-block; margin-top: 10px;">Open Today Follow-ups</a>
      <br/><br/>
      <p>If the button does not work, copy this link: <br/> ${deepLink}</p>
    `,
    'Today Follow-ups',
    deepLink,
  );
  if (outcome.sent) return 'sent';
  if (outcome.reason === 'dev_mock') return 'mock_dev';
  return 'skipped_no_smtp';
};
