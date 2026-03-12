"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVerificationEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'test@example.com',
        pass: process.env.EMAIL_PASS || 'password',
    },
});
const sendVerificationEmail = async (email, token) => {
    try {
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
        const verifyLink = `${backendUrl}/api/auth/verify-email?token=${token}`;
        const mailOptions = {
            from: process.env.EMAIL_USER || 'no-reply@seeakk.com',
            to: email,
            subject: 'Verify your Seeakk Account',
            html: `
        <h2>Welcome to Seeakk CRM!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <a href="${verifyLink}" style="padding: 10px 20px; background-color: #10b981; color: white; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Verify Email</a>
        <br/><br/>
        <p>Or copy this link into your browser: <br/> ${verifyLink}</p>
        <p>This link expires in 24 hours.</p>
      `,
        };
        if (!process.env.EMAIL_USER) {
            console.log('--- Mock Email Sent ---');
            console.log('To:', email);
            console.log('Verification Link:', verifyLink);
            console.log('-----------------------');
            return;
        }
        await transporter.sendMail(mailOptions);
        console.log(`Verification email sent to ${email}`);
    }
    catch (error) {
        console.error('Error sending verification email:', error);
    }
};
exports.sendVerificationEmail = sendVerificationEmail;
