const nodemailer = require('nodemailer');

// Set up a basic nodemailer transporter
// For dev/testing, we suggest setting environment variables or using standard gmail setups
// Provide fallback for missing ENV vars so the app won't crash
const transporter = nodemailer.createTransport({
    service: 'gmail', // or use your preferred email provider
    auth: {
        user: process.env.EMAIL_USER || 'test@example.com',
        pass: process.env.EMAIL_PASS || 'password',
    },
});

exports.sendVerificationEmail = async (email, token) => {
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

        // If no real ENV vars exist, we just log it (useful to see the token anyway)
        if (!process.env.EMAIL_USER) {
            console.log('--- Mock Email Sent ---');
            console.log('To:', email);
            console.log('Verification Link:', verifyLink);
            console.log('-----------------------');
            return;
        }

        await transporter.sendMail(mailOptions);
        console.log(`Verification email sent to ${email}`);
    } catch (error) {
        console.error('Error sending verification email:', error);
    }
};
