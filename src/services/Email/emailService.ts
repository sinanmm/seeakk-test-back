import nodemailer from 'nodemailer';
import logger from '../../utils/logger';

const isProduction = process.env.NODE_ENV === 'production';
const DEFAULT_FRONTEND_URL = 'https://lms-frontend-amber-beta.vercel.app';
const DEFAULT_BACKEND_URL = 'https://backend-2612.onrender.com';

const readEnv = (...keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
};

const isGmailProvider = (service: string, host: string): boolean =>
  service.toLowerCase() === 'gmail' || host.toLowerCase().includes('gmail.com');

const getEmailConfig = () => {
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

  return {
    service,
    host,
    port,
    secure,
    user,
    pass,
    from,
    configured: Boolean(user && pass),
  };
};

const isEmailConfigured = (): boolean => getEmailConfig().configured;
export const isEmailServiceConfigured = (): boolean => isEmailConfigured();

const getFrontendUrl = (): string => (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).trim().replace(/\/+$/, '');
const getBackendUrl = (): string => (process.env.BACKEND_URL || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, '');

const getTransporter = () => {
  const { user, pass, service, host, port, secure } = getEmailConfig();

  if (host && Number.isFinite(port) && port > 0) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  return nodemailer.createTransport({
    service: service || 'gmail',
    auth: { user, pass },
  });
};

export const verifyEmailTransport = async (): Promise<void> => {
  if (!isEmailConfigured()) {
    throw new Error('Email service is not configured. Set EMAIL_USER and EMAIL_PASS or SMTP_USER and SMTP_PASS.');
  }

  const transporter = getTransporter();
  await transporter.verify();
};

const sendOrLogEmail = async (
  to: string,
  subject: string,
  html: string,
  previewLinkLabel: string,
  previewLink: string,
): Promise<boolean> => {
  if (isProduction && !isEmailConfigured()) {
    logger.warn('Email service not configured; skipping outbound email', {
      to,
      subject,
      previewLinkLabel,
      previewLink,
      environment: process.env.NODE_ENV,
    });
    return false;
  }

  if (!isEmailConfigured()) {
    console.warn("⚠️ Email not configured — using mock mode");
    console.log("Mock email:", { to, subject, link: previewLink });
    return false;
  }

  try {
    const config = getEmailConfig();
    const transporter = getTransporter();
    await transporter.sendMail({
      from: config.from,
      to,
      subject,
      html,
    });
    return true;
  } catch (error: any) {
    logger.error('Email delivery failed', {
      to,
      subject,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code,
      response: error?.response,
      command: error?.command,
      environment: process.env.NODE_ENV,
    });
    throw new Error(
      `Email delivery failed for "${subject}". Check SMTP configuration and provider access.`,
    );
  }
};

export const sendVerificationEmail = async (email: string, token: string): Promise<void> => {
  const backendUrl = getBackendUrl();
  const verifyLink = `${backendUrl}/api/auth/verify-email?token=${token}`;

  await sendOrLogEmail(
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
};

export const sendPasswordResetEmail = async (email: string, name: string | null | undefined, token: string): Promise<void> => {
  const backendUrl = getBackendUrl();
  const resetLink = `${backendUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
  const displayName = name?.trim() || 'there';

  await sendOrLogEmail(
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
  const frontendUrl = getFrontendUrl();
  const backendUrl = getBackendUrl();
  const inviteLink = `${frontendUrl}/invite/accept?token=${encodeURIComponent(input.inviteToken)}`;
  const fallbackValidateLink = `${backendUrl}/api/auth/invite/validate?token=${encodeURIComponent(input.inviteToken)}`;
  const displayName = input.recipientName?.trim() || email;
  const inviterName = input.inviterName?.trim() || 'your administrator';

  return sendOrLogEmail(
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
};

export const sendFollowUpReminderEmail = async (
  email: string,
  input: {
    userDisplayName: string;
    leadName: string;
    scheduledAt: Date;
    description?: string;
    type?: string;
  },
): Promise<void> => {
  const appUrl = getFrontendUrl();
  const when = input.scheduledAt.toLocaleString();
  const subject = `Follow-up reminder: ${input.leadName}`;
  const deepLink = `${appUrl}/calendar/today`;

  await sendOrLogEmail(
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
};
