import nodemailer from 'nodemailer';

const isEmailConfigured = (): boolean => Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'test@example.com',
    pass: process.env.EMAIL_PASS || 'password',
  },
});

const sendOrLogEmail = async (to: string, subject: string, html: string, previewLinkLabel: string, previewLink: string): Promise<void> => {
  if (!isEmailConfigured()) {
    console.log('--- Mock Email Sent ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(`${previewLinkLabel}:`, previewLink);
    console.log('-----------------------');
    return;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@seeakk.com',
    to,
    subject,
    html,
  });
};

export const sendVerificationEmail = async (email: string, token: string): Promise<void> => {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
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
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
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
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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
